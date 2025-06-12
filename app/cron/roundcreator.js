const cron = require("node-cron");
const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");
const cardModel = require("../model/card.model");

// --- Helper Functions ---
// Get current IST datetime
function getISTNow() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

// Get start of the current hour in IST
function getCurrentRoundComboIST() {
  const now = getISTNow();
  now.setMinutes(0, 0, 0);
  return now;
}

// Get next round combo (next hour boundary in IST)
function getNextRoundComboIST() {
  const now = getISTNow();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return now;
}

// Get previous hour combo in IST
function getPreviousRoundComboIST() {
  const now = getISTNow();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() - 1);
  return now;
}

// Get just date (YYYY-MM-DD in IST)
function getISTDateOnly(istDate = getISTNow()) {
  return new Date(istDate.getFullYear(), istDate.getMonth(), istDate.getDate());
}

// --- CRON: Close current round at :55 IST ---
cron.schedule("55 * * * *", async () => {
  const istNow = getISTNow();
  const combo = getCurrentRoundComboIST();
  const dateOnly = getISTDateOnly(combo);

  console.log(`\n[CRON 55] Triggered at IST: ${istNow.toString()}`);

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

      console.log(`[CRON 55] Round missing — created & closed (roundId: ${nextRoundId})`);
    } else if (!round.isClosed) {
      round.isClosed = true;
      round.updatedAt = istNow;
      await round.save();
      console.log(`[CRON 55] Round closed (roundId: ${round.roundId})`);
    } else {
      console.log("[CRON 55] Round already closed.");
    }
  } catch (err) {
    console.error(`[CRON 55] Error: ${err.message}`);
  }
});

// --- CRON: Create next round at :00 IST ---
cron.schedule("0 * * * *", async () => {
  const istNow = getISTNow();
  const combo = getNextRoundComboIST();
  const dateOnly = getISTDateOnly(combo);

  console.log(`\n[CRON 00] Triggered at IST: ${istNow.toString()}`);

  try {
    const exists = await roundsModel.findOne({ combo });
    if (exists) {
      console.log("[CRON 00] Next round already exists.");
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

    console.log(`[CRON 00] Created next round (roundId: ${nextRoundId})`);
  } catch (err) {
    console.error(`[CRON 00] Error: ${err.message}`);
  }
});

// --- CRON: Process bets at :59 IST ---
cron.schedule("59 * * * *", async () => {
  const istNow = getISTNow();
  const combo = getCurrentRoundComboIST();

  console.log(`\n[CRON 59] Triggered at IST: ${istNow.toString()}`);

  try {
    const round = await roundsModel.findOne({ combo, isClosed: true });
    if (!round) {
      console.log(`[CRON 59] No closed round found for: ${combo.toISOString()}`);
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
      console.log(`[CRON 59] Assigned winning cardId ${round.cardId}`);
    }

    // Process all bets
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
      console.log(`[CRON 59] Credited ${bulkUserOps.length} user(s)`);
    }

    if (bulkBetOps.length) {
      await betModel.bulkWrite(bulkBetOps);
      console.log(`[CRON 59] Updated ${bulkBetOps.length} bet(s)`);
    }

    round.isProcessed = true;
    round.processedAt = istNow;
    round.updatedAt = istNow;
    await round.save();

    console.log(`[CRON 59] Round processed: ${combo.toISOString()}`);
  } catch (err) {
    console.error(`[CRON 59] Error: ${err.message}`);
  }
});

// --- CRON: Health check every 15 minutes ---
cron.schedule("*/15 * * * *", async () => {
  try {
    const istNow = getISTNow();
    console.log(`[HEALTH CHECK] Running - IST: ${istNow.toString()}`);

    const activeRound = await roundsModel.findOne({ isClosed: false }).sort({ createdAt: -1 });
    if (activeRound) {
      console.log(`[HEALTH CHECK] Active round: ${activeRound.roundId}, Combo: ${activeRound.combo.toISOString()}`);
    } else {
      console.log("[HEALTH CHECK] No active round.");
    }

    const currentCombo = getCurrentRoundComboIST();
    const shouldBeClosed = await roundsModel.findOne({ combo: { $lt: currentCombo }, isClosed: false });

    if (shouldBeClosed) {
      console.log(`[HEALTH CHECK] WARNING: Unclosed round found: ${shouldBeClosed.roundId}`);
    }
  } catch (err) {
    console.error(`[HEALTH CHECK] Error: ${err.message}`);
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
