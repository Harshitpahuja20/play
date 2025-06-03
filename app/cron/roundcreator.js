const cron = require("node-cron");
const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");
const cardModel = require("../model/card.model");

function getComboDate(offsetHours = 0) {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  now.setUTCHours(now.getUTCHours() + offsetHours);
  return now;
}

// Close previous round and create next round at minute 55
cron.schedule("55 * * * *", async () => {
  console.log(`[CRON 55] Starting close/create rounds at ${new Date().toISOString()}`);

  try {
    const prevRoundCombo = getComboDate(-1);
    const currentCombo = getComboDate(0);

    // 1. Find previous round
    let prevRound = await roundsModel.findOne({ combo: prevRoundCombo });

    if (!prevRound) {
      // Previous round doesn't exist — create it immediately as closed
      const lastRound = await roundsModel.findOne().sort({ roundId: -1 }).lean();
      const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

      prevRound = await roundsModel.create({
        combo: prevRoundCombo,
        roundId: nextRoundId,
        isClosed: true,
      });
      console.log(`[CRON 55] Previous round missing — created and closed: ${prevRoundCombo.toISOString()}`);
    } else if (!prevRound.isClosed) {
      // Previous round exists and is open — close it
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

      await roundsModel.create({
        combo: currentCombo,
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

// Process bets and assign winners at minute 59
cron.schedule("59 * * * *", async () => {
  console.log(`[CRON 59] Starting bet processing at ${new Date().toISOString()}`);

  try {
    const prevRoundCombo = getComboDate(-1);

    const round = await roundsModel.findOne({
      combo: prevRoundCombo,
      isClosed: true,
    });

    if (!round) {
      console.log(`[CRON 59] No closed round found for processing: ${prevRoundCombo.toISOString()}`);
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
        const [randomCard] = await cardModel.aggregate([{ $sample: { size: 1 } }]);
        if (!randomCard?._id) throw new Error("No cards available to assign as winner");
        round.cardId = randomCard._id;
      } else {
        // Assign card with lowest total bets as winner
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
