const cron = require("node-cron");
const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");
const cardModel = require("../model/card.model");

function getComboDate(offsetHours = 0) {
  const now = new Date();
  const IST_OFFSET = 5.5; // IST is UTC+5:30
  now.setUTCMinutes(0, 0, 0); // Set minutes, seconds, and milliseconds to 0 for clean hour
  now.setUTCHours(now.getUTCHours() + offsetHours + IST_OFFSET); // Adjust by UTC offset + IST

  // Fix for crossing midnight between days (to handle round creation after 11 PM)
  if (offsetHours === 0 && now.getUTCHours() === 0) {
    now.setUTCDate(now.getUTCDate() + 1); // Move to the next day
  }
  console.log(`offset ${offsetHours} ${now}`);
  return now;
}

// Cron job to close the previous round and create the next one
cron.schedule("55 * * * *", async () => {
  console.log(
    `[CRON 55] Starting close/create rounds at ${new Date().toISOString()}`
  );

  try {
    const prevRoundCombo = getComboDate(0); // Get the previous round date-time
    const currentCombo = getComboDate(1); // Get the current round date-time

    console.log(
      `[CRON 55] prevRoundCombo: ${prevRoundCombo.toISOString()}, currentCombo: ${currentCombo.toISOString()}`
    );

    // 1. Find previous round based on combo
    let prevRound = await roundsModel.findOne({ combo: prevRoundCombo });
    console.log(
      `[CRON 55] Found previous round: ${prevRound ? prevRound._id : "None"}`
    );

    if (!prevRound) {
      // If previous round doesn't exist, create it as closed
      const lastRound = await roundsModel
        .findOne()
        .sort({ roundId: -1 })
        .lean();
      const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

      // Create the previous round with both date, time, and combo
      const date = new Date(
        prevRoundCombo.getUTCFullYear(),
        prevRoundCombo.getUTCMonth(),
        prevRoundCombo.getUTCDate()
      ); // Set to midnight
      const time = new Date(prevRoundCombo); // Use the same date but with the specific time

      prevRound = await roundsModel.create({
        date: date, // Save only date part (e.g., 2025-05-15)
        time: time, // Save specific time part (e.g., 2025-05-15T14:00:00.000Z)
        combo: time, // combo will be the full date-time (e.g., 2025-05-15T14:00:00.000Z)
        roundId: nextRoundId,
        isClosed: true,
      });
      console.log(
        `[CRON 55] Previous round missing — created and closed: ${prevRoundCombo.toISOString()}`
      );
    } else if (!prevRound.isClosed) {
      // Close the previous round if it's not closed
      prevRound.isClosed = true;
      await prevRound.save();
      console.log(
        `[CRON 55] Closed previous round: ${prevRoundCombo.toISOString()}`
      );
    } else {
      console.log(
        `[CRON 55] Previous round already closed: ${prevRoundCombo.toISOString()}`
      );
    }

    // 2. Create the next round if it doesn't exist
    const existsNext = await roundsModel.findOne({ combo: currentCombo });
    console.log(
      `[CRON 55] Found next round: ${existsNext ? existsNext._id : "None"}`
    );

    if (!existsNext) {
      const lastRound = await roundsModel
        .findOne()
        .sort({ roundId: -1 })
        .lean();
      const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

      const date = new Date(
        Date.UTC(
          currentCombo.getUTCFullYear(),
          currentCombo.getUTCMonth(),
          currentCombo.getUTCDate()
        )
      );

      const time = new Date(currentCombo); // Use the same date but with the specific time

      // Create the next round with both date, time, and combo
      await roundsModel.create({
        date: date,
        time: time,
        combo: time,
        roundId: nextRoundId,
        isClosed: false,
      });
      console.log(
        `[CRON 55] Created next round: ${currentCombo.toISOString()}, roundId: ${nextRoundId}`
      );
    } else {
      console.log(
        `[CRON 55] Next round already exists: ${currentCombo.toISOString()}`
      );
    }
  } catch (error) {
    console.error("[CRON 55] Error:", error);
  }
});

// Cron job to process bets and assign winners
cron.schedule("59 * * * *", async () => {
  console.log(
    `[CRON 59] Starting bet processing at ${new Date().toISOString()}`
  );

  try {
    const prevRoundCombo = getComboDate(0);

    // Ensure previous round is closed
    const round = await roundsModel.findOne({
      combo: prevRoundCombo,
      isClosed: true,
    });

    if (!round) {
      console.log(
        `[CRON 59] No closed round found for processing: ${prevRoundCombo.toISOString()}`
      );
      return;
    }

    // Always assign a winning card if none assigned yet
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
        // No bets - pick random card
        const [randomCard] = await cardModel.aggregate([
          { $sample: { size: 1 } },
        ]);
        if (!randomCard?._id)
          throw new Error("No cards available to assign as winner");
        round.cardId = randomCard._id;
      } else {
        // Assign card with lowest total bets as winner
        round.cardId = cardBets[0]._id;
      }

      await round.save();
      console.log(
        `[CRON 59] Assigned cardId ${
          round.cardId
        } to round ${round.combo.toISOString()}`
      );
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
      console.log(
        `[CRON 59] Updated balances for ${bulkUserOps.length} winners.`
      );
    }

    if (bulkBetOps.length > 0) {
      await betModel.bulkWrite(bulkBetOps);
      console.log(`[CRON 59] Updated results for ${bulkBetOps.length} bets.`);
    }

    console.log(
      `[CRON 59] Round ${round.combo.toISOString()} processing complete.`
    );
  } catch (error) {
    console.error("[CRON 59] Error:", error);
  }
});
