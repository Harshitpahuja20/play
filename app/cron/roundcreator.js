const cron = require("node-cron");
const fs = require("fs");
const moment = require("moment");

const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");
const cardModel = require("../model/card.model");

// --- Helper Functions (IST-aligned logic) ---
function getUTCNow() {
  return moment.utc().toDate();
}

// NEW: Align round to IST hour, then return IST for storage
function getCurrentRoundComboIST() {
  const istNow = moment.tz(getUTCNow(), "Asia/Kolkata");
  const flooredIST = istNow.clone().startOf("hour");
  return flooredIST.toDate(); // returns IST timestamp of that hour
}

function getNextRoundComboIST() {
  const istNow = moment.tz(getUTCNow(), "Asia/Kolkata");
  const nextIST = istNow.clone().startOf("hour").add(1, "hour");
  return nextIST.toDate();
}

function getPreviousRoundComboIST() {
  const istNow = moment.tz(getUTCNow(), "Asia/Kolkata");
  const prevIST = istNow.clone().startOf("hour").subtract(1, "hour");
  return prevIST.toDate();
}

function getISTDateOnly(date = getUTCNow()) {
  return moment.tz(date, "Asia/Kolkata").startOf("day").toDate();
}

function logToFile(msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
  // fs.appendFileSync("/var/log/myapp_cron.log", `[${timestamp}] ${msg}\n`);
}

// --- CRON: Close current round at :55 IST ---
cron.schedule("25 * * * *", async () => {
  const now = getUTCNow();
  const combo = getCurrentRoundComboIST(); // Change to IST
  const dateOnly = getISTDateOnly(combo); // Change to IST

  logToFile(`[CRON 55] Triggered at UTC: ${now.toISOString()}`);

  try {
    let round = await roundsModel.findOne({ combo });

    if (!round) {
      const lastRound = await roundsModel
        .findOne()
        .sort({ createdAt: -1 })
        .lean();
      const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

      await roundsModel.create({
        date: dateOnly,
        time: combo,
        combo,
        roundId: nextRoundId,
        isClosed: true,
        createdAt: now,
        updatedAt: now,
      });

      logToFile(
        `[CRON 55] Round missing — created & closed (roundId: ${nextRoundId})`
      );
    } else if (!round.isClosed) {
      round.isClosed = true;
      round.updatedAt = now;
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
cron.schedule("30 * * * *", async () => {
  const now = getUTCNow();
  const combo = getNextRoundComboIST(); // Change to IST
  const dateOnly = getISTDateOnly(combo); // Change to IST

  logToFile(`[CRON 00] Triggered at UTC: ${now.toISOString()}`);

  try {
    const exists = await roundsModel.findOne({ combo });
    if (exists) {
      logToFile(`[CRON 00] Next round already exists.`);
      return;
    }

    const lastRound = await roundsModel
      .findOne()
      .sort({ createdAt: -1 })
      .lean();
    const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

    await roundsModel.create({
      date: dateOnly,
      time: combo,
      combo,
      roundId: nextRoundId,
      isClosed: false,
      createdAt: now,
      updatedAt: now,
    });

    logToFile(`[CRON 00] Created next round (roundId: ${nextRoundId})`);
  } catch (err) {
    logToFile(`[CRON 00] Error: ${err.message}`);
  }
});

// --- CRON: Process bets at :59 IST ---
cron.schedule("29 * * * *", async () => {
  const now = getUTCNow();
  const combo = getCurrentRoundComboIST(); // Change to IST

  logToFile(`[CRON 59] Triggered at UTC: ${now.toISOString()}`);

  try {
    const round = await roundsModel.findOne({ combo, isClosed: true });
    if (!round) {
      logToFile(`[CRON 59] No closed round found for: ${combo.toISOString()}`);
      return;
    }

    if (!round.cardId) {
      const allCards = await cardModel.find({}, { _id: 1 }); // Get all 12 cards
      const allCardIds = allCards.map((card) => card._id);

      // Get bet totals for each card in this round
      const bets = await betModel.aggregate([
        { $match: { roundId: round._id } },
        { $group: { _id: "$cardId", totalBets: { $sum: "$betAmount" } } },
      ]);

      const betMap = new Map(bets.map((b) => [b._id.toString(), b.totalBets]));

      // Find cards with zero bets
      const cardsWithNoBets = allCardIds.filter(
        (cardId) => !betMap.has(cardId.toString())
      );

      if (cardsWithNoBets.length > 0) {
        // Pick one randomly among cards with no bets
        const randomIndex = Math.floor(Math.random() * cardsWithNoBets.length);
        round.cardId = cardsWithNoBets[randomIndex];
      } else {
        // All cards have bets — pick the one with the least total bets
        const cardWithLeastBet = bets.sort(
          (a, b) => a.totalBets - b.totalBets
        )[0];
        round.cardId = cardWithLeastBet._id;
      }

      round.resultDeclaredAt = now;
      round.updatedAt = now;
      await round.save();
      logToFile(`[CRON 59] Assigned winning cardId ${round.cardId}`);
    }

    const bets = await betModel.find({ roundId: round._id });
    const bulkUserOps = [];
    const bulkBetOps = [];

    for (const bet of bets) {
      const isWin = bet.cardId.toString() === round.cardId.toString();
      const resultAmount = isWin ? bet.betAmount * 10 : bet.betAmount;
      const userCredit = isWin ? resultAmount : 0;

      bulkBetOps.push({
        updateOne: {
          filter: { _id: bet._id },
          update: {
            $set: {
              status: isWin ? "win" : "loss",
              resultAmount,
              processedAt: now,
              updatedAt: now,
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
              $set: { updatedAt: now },
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
    round.processedAt = now;
    round.updatedAt = now;
    await round.save();

    logToFile(`[CRON 59] Round processed: ${combo.toISOString()}`);
  } catch (err) {
    logToFile(`[CRON 59] Error: ${err.message}`);
  }
});

// --- CRON: Health check every 15 minutes (UTC) ---
cron.schedule("*/15 * * * *", async () => {
  try {
    const now = getUTCNow();
    logToFile(`[HEALTH CHECK] Running - UTC: ${now.toISOString()}`);

    const activeRound = await roundsModel
      .findOne({ isClosed: false })
      .sort({ createdAt: -1 });
    if (activeRound) {
      logToFile(
        `[HEALTH CHECK] Active round: ${
          activeRound.roundId
        }, Combo: ${activeRound.combo.toISOString()}`
      );
    } else {
      logToFile(`[HEALTH CHECK] No active round.`);
    }

    const currentCombo = getCurrentRoundComboIST();
    const shouldBeClosed = await roundsModel.findOne({
      combo: { $lt: currentCombo },
      isClosed: false,
    });

    if (shouldBeClosed) {
      logToFile(
        `[HEALTH CHECK] WARNING: Unclosed round found: ${shouldBeClosed.roundId}`
      );
    }
  } catch (err) {
    logToFile(`[HEALTH CHECK] Error: ${err.message}`);
  }
});

// Export IST-based helper functions
module.exports = {
  getUTCNow,
  getCurrentRoundComboIST,
  getNextRoundComboIST,
  getPreviousRoundComboIST,
  getISTDateOnly,
};
