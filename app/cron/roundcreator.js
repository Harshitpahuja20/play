const cron = require("node-cron");
const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");
const cardModel = require("../model/card.model");

// runs every hour
cron.schedule("59 * * * *", async () => {
  console.log("cron 1 start");
  
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");

    const comboDate = new Date(`${year}-${month}-${day}T${hour}:00:00.000Z`);
    const dateOnly = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

    // Find current open round
    const round = await roundsModel.findOne({
      date: dateOnly,
      time: comboDate,
      isClosed: false,
    });

    if (!round) {
      console.log("[CRON] No open round found for processing");
      return;
    }

    // Assign cardId if missing
    if (!round.cardId) {
      let cardBets = await betModel.aggregate([
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
        const [randomCard] = await cardModel.aggregate([
          { $sample: { size: 1 } },
        ]);
        round.cardId = randomCard?._id;
      } else {
        round.cardId = cardBets[0]._id;
      }

      await round.save();

      console.log(
        `[CRON] Set cardId ${round.cardId} for round ${comboDate.toISOString()}`
      );
    }

    const winningCardId = round.cardId.toString();

    // Fetch all bets for this round
    const bets = await betModel.find({ roundId: round._id });

    const bulkUserOps = [];
    const bulkBetOps = [];

    // Process bets concurrently
    await Promise.all(
      bets.map(async (bet) => {
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
      })
    );

    if (bulkUserOps.length > 0) await User.bulkWrite(bulkUserOps);
    if (bulkBetOps.length > 0) await betModel.bulkWrite(bulkBetOps);

    // Close the round
    round.isClosed = true;
    await round.save();

    console.log(
      `[CRON] Round ${comboDate.toISOString()} processed and closed.`
    );
  } catch (error) {
    console.error("[CRON] evaluate-last-hour error:", error);
  }
});

// runs every 55 minutes to close round and create next round
cron.schedule("55 * * * *", async () => {
  try {
    console.log(`Every 55 minutes cron job start`);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = now.getHours();

    const currentHourStr = String(hour).padStart(2, "0");
    const nextHour = (hour + 1) % 24;
    const nextHourStr = String(nextHour).padStart(2, "0");

    // Current round combo datetime
    const currentCombo = new Date(
      `${year}-${month}-${day}T${currentHourStr}:00:00.000Z`
    );
    // Next round combo datetime
    const nextCombo = new Date(
      `${year}-${month}-${day}T${nextHourStr}:00:00.000Z`
    );

    // Date only for day grouping
    const dateOnly = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

    // 1. Close current round if open
    const currentRound = await roundsModel.findOne({
      combo: currentCombo,
      isClosed: false,
    });
    if (currentRound) {
      currentRound.isClosed = true;
      await currentRound.save();
      console.log(`[Round Cron] Closed round: ${currentCombo.toISOString()}`);
    } else {
      console.log(
        `[Round Cron] No open round found for closing at: ${currentCombo.toISOString()}`
      );
    }

    // 2. Check if next round exists
    const existsNext = await roundsModel.findOne({ combo: nextCombo });
    if (existsNext) {
      console.log(
        `[Round Cron] Next round ${nextCombo.toISOString()} already exists`
      );
      return;
    }

    // 3. Get last roundId and increment
    const lastRound = await roundsModel.findOne().sort({ roundId: -1 }).lean();
    const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

    // 4. Create the next round
    await roundsModel.create({
      date: dateOnly,
      time: nextCombo,
      combo: nextCombo,
      roundId: nextRoundId,
      isClosed: false,
    });
    console.log(
      `[Round Cron] Created next round: ${nextCombo.toISOString()}, roundId: ${nextRoundId}`
    );
  } catch (error) {
    console.error("[Round Cron] Error:", error);
  }
});
