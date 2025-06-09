const cron = require("node-cron");
const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");
const cardModel = require("../model/card.model");

/**
 * Returns a Date object in IST (not UTC), rounded to the hour, with optional hour offset.
 * @param {number} offsetHours
 * @returns {Date} Date object representing IST hour start
 */
function getNextRoundId(now = new Date()) {
  // Clone the date and adjust the time for IST
  const nextHourDate = new Date(now);
  nextHourDate.setUTCHours(nextHourDate.getUTCHours());

  // Add one hour to the adjusted time
  nextHourDate.setHours(nextHourDate.getHours() + 1);

  const year = nextHourDate.getFullYear();
  const month = String(nextHourDate.getMonth() + 1).padStart(2, "0");
  const day = String(nextHourDate.getDate()).padStart(2, "0");
  const hour = String(nextHourDate.getHours()).padStart(2, "0");

  return new Date(`${year}-${month}-${day}T${hour}:00:00.000Z`);
}

function getCurrentRoundId(now = new Date()) {
  // Adjust the time for IST
  now.setUTCHours(now.getUTCHours());

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");

  return new Date(`${year}-${month}-${day}T${hour}:00:00.000Z`);
}

function getPreviousRoundId(now = new Date()) {
  // Clone the date and adjust the time for IST
  const prevHourDate = new Date(now);
  prevHourDate.setUTCHours(prevHourDate.getUTCHours());

  // Subtract one hour from the adjusted time
  prevHourDate.setHours(prevHourDate.getHours() - 1);

  const year = prevHourDate.getFullYear();
  const month = String(prevHourDate.getMonth() + 1).padStart(2, "0");
  const day = String(prevHourDate.getDate()).padStart(2, "0");
  const hour = String(prevHourDate.getHours()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:00:00.000Z`;
}

function logCombo(label, date) {
  console.log(`original date ${date}`)
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  console.log(`[${label}] UTC: ${date.toISOString()}, IST: ${ist.toISOString()}`);
}

// CRON to close current round and create next round at :55 of every hour
cron.schedule("22 * * * *", async () => {
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
        date: new Date(Date.UTC(prevCombo.getUTCFullYear(), prevCombo.getUTCMonth(), prevCombo.getUTCDate())),
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
        date: new Date(Date.UTC(nextCombo.getUTCFullYear(), nextCombo.getUTCMonth(), nextCombo.getUTCDate())),
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

// CRON to process bets and assign winners at :59 of every hour
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
