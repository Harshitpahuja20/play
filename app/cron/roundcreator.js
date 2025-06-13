const cron = require("node-cron");
const fs = require("fs");
const moment = require("moment-timezone");

const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");
const cardModel = require("../model/card.model");

// --- Helper Functions ---
function getISTNow() {
  return moment().tz("Asia/Kolkata").toDate();
}

function getCurrentRoundComboIST() {
  const now = moment().tz("Asia/Kolkata").startOf("hour");
  return now.toDate();
}

function getNextRoundComboIST() {
  const now = moment().tz("Asia/Kolkata").startOf("hour").add(1, "hour");
  return now.toDate();
}

function getPreviousRoundComboIST() {
  const now = moment().tz("Asia/Kolkata").startOf("hour").subtract(1, "hour");
  return now.toDate();
}

function getISTDateOnly(date = getISTNow()) {
  const d = moment(date).tz("Asia/Kolkata").startOf("day");
  return d.toDate();
}

function logToFile(msg) {
  fs.appendFileSync("/var/log/myapp_cron.log", `[${new Date().toISOString()}] ${msg}\n`);
}

// --- CRON: Close current round at :55 IST ---
cron.schedule("55 * * * *", async () => {
  const istNow = getISTNow();
  const combo = getCurrentRoundComboIST();
  const dateOnly = getISTDateOnly(combo);

  logToFile(`[CRON 55] Triggered at IST: ${istNow}`);

  try {
    let round = await roundsModel.findOne({ combo });

    if (!round) {
      const lastRound = await roundsModel.findOne().sort({ createdAt: -1 }).lean();
      const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

      await roundsModel.create({
        date: dateOnly,
        time: combo,
        combo: combo,
        roundId: nextRoundId,
        isClosed: true,
        createdAt: istNow,
        updatedAt: istNow,
      });

      logToFile(`[CRON 55] Round missing — created & closed (roundId: ${nextRoundId})`);
    } else if (!round.isClosed) {
      round.isClosed = true;
      round.updatedAt = istNow;
      await round.save();
      logToFile(`[CRON 55] Round closed (roundId: ${round.roundId})`);
    } else {
      logToFile(`[CRON 55] Round already closed.`);
    }
  } catch (err) {
    logToFile(`[CRON 55] Error: ${err.message}`);
  }
});

// --- CRON: Create next round at :00 IST ---
cron.schedule("0 * * * *", async () => {
  const istNow = getISTNow();
  const combo = getNextRoundComboIST();
  const dateOnly = getISTDateOnly(combo);

  logToFile(`[CRON 00] Triggered at IST: ${istNow}`);

  try {
    const exists = await roundsModel.findOne({ combo });
    if (exists) {
      logToFile(`[CRON 00] Next round already exists.`);
      return;
    }

    const lastRound = await roundsModel.findOne().sort({ createdAt: -1 }).lean();
    const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

    await roundsModel.create({
      date: dateOnly,
      time: combo,
      combo: combo,
      roundId: nextRoundId,
      isClosed: false,
      createdAt: istNow,
      updatedAt: istNow,
    });

    logToFile(`[CRON 00] Created next round (roundId: ${nextRoundId})`);
  } catch (err) {
    logToFile(`[CRON 00] Error: ${err.message}`);
  }
});

// --- CRON: Process bets at :59 IST ---
cron.schedule("59 * * * *", async () => {
  const istNow = getISTNow();
  const combo = getCurrentRoundComboIST();

  logToFile(`[CRON 59] Triggered at IST: ${istNow}`);

  try {
    const round = await roundsModel.findOne({ combo, isClosed: true });
    if (!round) {
      logToFile(`[CRON 59] No closed round found for: ${combo.toISOString()}`);
      return;
    }

    if (!round.cardId) {
      const cardBets = await betModel.aggregate([
        { $match: { roundId: round._id } },
        { $group: { _id: "$cardId", totalBets: { $sum: "$betAmount" } } },
        { $sort: { totalBets: 1 } },
        { $limit: 1 },
      ]);

      if (cardBets.length > 0) {
        round.cardId = cardBets[0]._id;
      } else {
        const [randomCard] = await cardModel.aggregate([{ $sample: { size: 1 } }]);
        if (!randomCard) throw new Error("No card available.");
        round.cardId = randomCard._id;
      }

      round.resultDeclaredAt = istNow;
      round.updatedAt = istNow;
      await round.save();
      logToFile(`[CRON 59] Assigned winning cardId ${round.cardId}`);
    }

    const bets = await betModel.find({ roundId: round._id });
    const bulkUserOps = [];
    const bulkBetOps = [];

    for (const bet of bets) {
      const isWin = bet.cardId.toString() === round.cardId.toString();
      const resultAmount = isWin ? bet.betAmount * 11 : bet.betAmount;
      const userCredit = isWin ? resultAmount : 0;

      bulkBetOps.push({
        updateOne: {
          filter: { _id: bet._id },
          update: {
            $set: {
              status: isWin ? "win" : "loss",
              resultAmount,
              processedAt: istNow,
              updatedAt: istNow,
            },
          },
        },
      });

      if (userCredit > 0) {
        bulkUserOps.push({
          updateOne: {
            filter: { _id: bet.userId },
            update: {
              $inc: { balance: userCredit },
              $set: { updatedAt: istNow },
            },
          },
        });
      }
    }

    if (bulkUserOps.length) {
      await User.bulkWrite(bulkUserOps);
      logToFile(`[CRON 59] Credited ${bulkUserOps.length} user(s)`);
    }

    if (bulkBetOps.length) {
      await betModel.bulkWrite(bulkBetOps);
      logToFile(`[CRON 59] Updated ${bulkBetOps.length} bet(s)`);
    }

    round.isProcessed = true;
    round.processedAt = istNow;
    round.updatedAt = istNow;
    await round.save();

    logToFile(`[CRON 59] Round processed: ${combo.toISOString()}`);
  } catch (err) {
    logToFile(`[CRON 59] Error: ${err.message}`);
  }
});

// --- CRON: Health check every 15 minutes ---
cron.schedule("*/15 * * * *", async () => {
  try {
    const istNow = getISTNow();
    logToFile(`[HEALTH CHECK] Running - IST: ${istNow}`);

    const activeRound = await roundsModel.findOne({ isClosed: false }).sort({ createdAt: -1 });
    if (activeRound) {
      logToFile(`[HEALTH CHECK] Active round: ${activeRound.roundId}, Combo: ${activeRound.combo.toISOString()}`);
    } else {
      logToFile(`[HEALTH CHECK] No active round.`);
    }

    const currentCombo = getCurrentRoundComboIST();
    const shouldBeClosed = await roundsModel.findOne({ combo: { $lt: currentCombo }, isClosed: false });

    if (shouldBeClosed) {
      logToFile(`[HEALTH CHECK] WARNING: Unclosed round found: ${shouldBeClosed.roundId}`);
    }
  } catch (err) {
    logToFile(`[HEALTH CHECK] Error: ${err.message}`);
  }
});

// Exported helpers
module.exports = {
  getISTNow,
  getCurrentRoundComboIST,
  getNextRoundComboIST,
  getPreviousRoundComboIST,
  getISTDateOnly,
};
