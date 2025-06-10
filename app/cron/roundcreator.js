const cron = require("node-cron");
const { DateTime } = require("luxon");
const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");
const cardModel = require("../model/card.model");

const IST_ZONE = "Asia/Kolkata";

/**
 * Gets the current round datetime in IST, rounded to the current hour.
 */
function getCurrentRoundId() {
  const nowIST = DateTime.now().setZone(IST_ZONE).startOf("hour");
  return nowIST.toUTC().toJSDate();
}

/**
 * Gets the next round datetime in IST (next hour), handling day rollover.
 */
function getNextRoundId() {
  const nextIST = DateTime.now().setZone(IST_ZONE).plus({ hours: 1 }).startOf("hour");
  return nextIST.toUTC().toJSDate();
}

/**
 * Gets the previous round datetime in IST (previous hour).
 */
function getPreviousRoundId() {
  const prevIST = DateTime.now().setZone(IST_ZONE).minus({ hours: 1 }).startOf("hour");
  return prevIST.toUTC().toJSDate();
}

/**
 * Logs UTC and IST time for debugging.
 */
function logCombo(label, utcDate) {
  const ist = DateTime.fromJSDate(utcDate).setZone(IST_ZONE);
  console.log(`[${label}] UTC: ${utcDate.toISOString()}, IST: ${ist.toISO()}`);
}

// CRON to close current round and create next round at :55 IST every hour
cron.schedule("20 * * * *", async () => {
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

      prevRound = await roundsModel.create({
        date: new Date(prevCombo.getFullYear(), prevCombo.getMonth(), prevCombo.getDate()),
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

      await roundsModel.create({
        date: new Date(nextCombo.getFullYear(), nextCombo.getMonth(), nextCombo.getDate()),
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
