const cron = require("node-cron");
const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");
const cardModel = require("../model/card.model");

// Returns IST time rounded down to start of hour, with optional hour offset
function getRoundedISTHourDate(offsetHours = 0) {
  const now = new Date();

  // Convert current UTC to IST by adding 5.5 hours (5 hours 30 minutes)
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  ist.setMinutes(0, 0, 0); // round down to start of the hour

  // Apply offset (e.g., 0 for current hour, +1 for next hour)
  ist.setHours(ist.getHours() + offsetHours);

  return ist;
}

// Cron job to close current round and create next round at 55 minutes past each hour
cron.schedule("55 * * * *", async () => {
  console.log(`[CRON 55] Starting close/create rounds at ${new Date().toISOString()}`);

  try {
    const prevRoundCombo = getRoundedISTHourDate(0);  // current hour round to close
    const currentCombo = getRoundedISTHourDate(1);    // next hour round to create

    console.log(`[CRON 55] prevRoundCombo (current hour): ${prevRoundCombo.toISOString()}`);
    console.log(`[CRON 55] currentCombo (next hour): ${currentCombo.toISOString()}`);

    // 1. Close previous (current hour) round if not closed, or create closed if missing
    let prevRound = await roundsModel.findOne({ combo: prevRoundCombo });

    if (!prevRound) {
      const lastRound = await roundsModel.findOne().sort({ roundId: -1 }).lean();
      const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

      const date = new Date(Date.UTC(
        prevRoundCombo.getUTCFullYear(),
        prevRoundCombo.getUTCMonth(),
        prevRoundCombo.getUTCDate()
      ));
      const time = new Date(prevRoundCombo);

      prevRound = await roundsModel.create({
        date,
        time,
        combo: time,
        roundId: nextRoundId,
        isClosed: true,
      });
      console.log(`[CRON 55] Previous round missing — created and closed: ${prevRoundCombo.toISOString()}`);
    } else if (!prevRound.isClosed) {
      prevRound.isClosed = true;
      await prevRound.save();
      console.log(`[CRON 55] Closed previous round: ${prevRoundCombo.toISOString()}`);
    } else {
      console.log(`[CRON 55] Previous round already closed: ${prevRoundCombo.toISOString()}`);
    }

    // 2. Create next round if missing
    const existsNext = await roundsModel.findOne({ combo: currentCombo });

    if (!existsNext) {
      const lastRound = await roundsModel.findOne().sort({ roundId: -1 }).lean();
      const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

      const date = new Date(Date.UTC(
        currentCombo.getUTCFullYear(),
        currentCombo.getUTCMonth(),
        currentCombo.getUTCDate()
      ));
      const time = new Date(currentCombo);

      await roundsModel.create({
        date,
        time,
        combo: time,
        roundId: nextRoundId,
        isClosed: false,
      });
      console.log(`[CRON 55] Created next round: ${currentCombo.toISOString()}, roundId: ${nextRoundId}`);
    } else {
      console.log(`[CRON 55] Next round already exists: ${currentCombo.toISOString()}`);
    }
  } catch (error) {
    console.error("[CRON 55] Error:", error);
  }
});

// Cron job to process bets and assign winners at 59 minutes past each hour
cron.schedule("59 * * * *", async () => {
  console.log(`[CRON 59] Starting bet processing at ${new Date().toISOString()}`);

  try {
    const prevRoundCombo = getRoundedISTHourDate(0);  // current hour round for processing

    const round = await roundsModel.findOne({
      combo: prevRoundCombo,
      isClosed: true,
    });

    if (!round) {
      console.log(`[CRON 59] No closed round found for processing: ${prevRoundCombo.toISOString()}`);
      return;
    }

    // Assign winning card if not assigned
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

      if (cardBets.length === 0) {
        const [randomCard] = await cardModel.aggregate([{ $sample: { size: 1 } }]);
        if (!randomCard?._id) throw new Error("No cards available to assign as winner");
        round.cardId = randomCard._id;
      } else {
        round.cardId = cardBets[0]._id;
      }

      await round.save();
      console.log(`[CRON 59] Assigned cardId ${round.cardId} to round ${round.combo.toISOString()}`);
    }

    const winningCardId = round.cardId.toString();

    const bets = await betModel.find({ roundId: round._id });

    const bulkUserOps = [];
    const bulkBetOps = [];

    for (const bet of bets) {
      const isWin = bet.cardId.toString() === winningCardId;
      const resultAmount = isWin ? bet.betAmount * 11 : bet.betAmount;
      const userCredit = isWin ? resultAmount : 0;

      bulkBetOps.push({
        updateOne: {
          filter: { _id: bet._id },
          update: { $set: { status: isWin ? "win" : "loss", resultAmount } },
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

    if (bulkUserOps.length > 0) {
      await User.bulkWrite(bulkUserOps);
      console.log(`[CRON 59] Updated balances for ${bulkUserOps.length} winners.`);
    }

    if (bulkBetOps.length > 0) {
      await betModel.bulkWrite(bulkBetOps);
      console.log(`[CRON 59] Updated results for ${bulkBetOps.length} bets.`);
    }

    console.log(`[CRON 59] Round ${round.combo.toISOString()} processing complete.`);
  } catch (error) {
    console.error("[CRON 59] Error:", error);
  }
});
