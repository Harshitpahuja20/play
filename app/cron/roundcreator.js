const cron = require("node-cron");
const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");
const cardModel = require("../model/card.model");

// Constant for IST offset in milliseconds
const IST_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Get UTC Date aligned to the current IST hour.
 */
function getCurrentRoundId(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setMinutes(0, 0, 0);
  return new Date(ist.getTime());
}

/**
 * Get UTC Date aligned to the next IST hour.
 */
function getNextRoundId(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setMinutes(0, 0, 0);
  ist.setHours(ist.getHours() + 1);
  return new Date(ist.getTime());
}

/**
 * Get UTC Date aligned to the previous IST hour.
 */
function getPreviousRoundId(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setMinutes(0, 0, 0);
  ist.setHours(ist.getHours() - 1);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/**
 * Convert UTC Date to ISO string in IST for display/logging.
 */
function getISTISOString(date) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return ist.toISOString().replace("Z", "+05:30");
}

/**
 * Log combo UTC and IST view for debug.
 */
function logCombo(label, utcDate) {
  console.log(`[${label}] UTC: ${utcDate.toISOString()}, IST: ${getISTISOString(utcDate)}`);
}

// CRON to close current round and create next round at :55 IST every hour
cron.schedule("55 * * * *", async () => {
  console.log(`\n[CRON 55] Triggered at ${new Date().toISOString()}`);

  try {
    const prevCombo = getCurrentRoundId();
    const nextCombo = getNextRoundId();

    logCombo("Prev Combo", prevCombo);
    logCombo("Next Combo", nextCombo);

    // ===== Close Previous Round =====
    let prevRound = await roundsModel.findOne({ combo: prevCombo });

    if (!prevRound) {
      const lastRound = await roundsModel.findOne().sort({ roundId: -1 }).lean();
      const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

      const istDate = new Date(prevCombo.getTime() + IST_OFFSET_MS);
      await roundsModel.create({
        date: new Date(istDate.getFullYear(), istDate.getMonth(), istDate.getDate()),
        time: prevCombo,
        combo: prevCombo,
        roundId: nextRoundId,
        isClosed: true,
      });

      console.log(`[CRON 55] Previous round missing — created & closed.`);
    } else if (!prevRound.isClosed) {
      prevRound.isClosed = true;
      await prevRound.save();
      console.log(`[CRON 55] Closed existing previous round.`);
    } else {
      console.log(`[CRON 55] Previous round already closed.`);
    }

    // ===== Create Next Round =====
    const existsNext = await roundsModel.findOne({ combo: nextCombo });

    if (!existsNext) {
      const lastRound = await roundsModel.findOne().sort({ roundId: -1 }).lean();
      const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

      const istDate = new Date(nextCombo.getTime() + IST_OFFSET_MS);
      await roundsModel.create({
        date: new Date(istDate.getFullYear(), istDate.getMonth(), istDate.getDate()),
        time: nextCombo,
        combo: nextCombo,
        roundId: nextRoundId,
        isClosed: false,
      });

      console.log(`[CRON 55] Created next round (roundId: ${nextRoundId})`);
    } else {
      console.log(`[CRON 55] Next round already exists.`);
    }
  } catch (err) {
    console.error(`[CRON 55] Error: ${err.message}`);
  }
});

// CRON to process bets and assign winners at :59 IST every hour
cron.schedule("59 * * * *", async () => {
  console.log(`\n[CRON 59] Triggered at ${new Date().toISOString()}`);

  try {
    const combo = getCurrentRoundId();
    const round = await roundsModel.findOne({ combo, isClosed: true });

    if (!round) {
      console.log(`[CRON 59] No closed round found for: ${combo.toISOString()}`);
      return;
    }

    // ===== Assign Winning Card (if not already) =====
    if (!round.cardId) {
      const cardBets = await betModel.aggregate([
        { $match: { roundId: round._id } },
        {
          $group: {
            _id: "$cardId",
            totalBets: { $sum: "$betAmount" },
          },
        },
        { $sort: { totalBets: 1 } },
        { $limit: 1 },
      ]);

      if (cardBets.length > 0) {
        round.cardId = cardBets[0]._id;
      } else {
        const [randomCard] = await cardModel.aggregate([{ $sample: { size: 1 } }]);
        if (!randomCard) throw new Error("No card available for assignment.");
        round.cardId = randomCard._id;
      }

      await round.save();
      console.log(`[CRON 59] Assigned cardId ${round.cardId} to round.`);
    }

    // ===== Process All Bets =====
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
            },
          },
        },
      });

      if (userCredit > 0) {
        bulkUserOps.push({
          updateOne: {
            filter: { _id: bet.userId },
            update: { $inc: { balance: userCredit } },
          },
        });
      }
    }

    if (bulkUserOps.length) {
      await User.bulkWrite(bulkUserOps);
      console.log(`[CRON 59] Updated balances for ${bulkUserOps.length} users.`);
    }

    if (bulkBetOps.length) {
      await betModel.bulkWrite(bulkBetOps);
      console.log(`[CRON 59] Updated bet statuses for ${bulkBetOps.length} bets.`);
    }

    console.log(`[CRON 59] Processing complete for round: ${combo.toISOString()}`);
  } catch (err) {
    console.error(`[CRON 59] Error: ${err.message}`);
  }
});
