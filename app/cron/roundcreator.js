const cron = require("node-cron");
const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");

cron.schedule("* * * * *", async () => {
  try {
    console.log("Cron1 run");

    const now   = new Date();
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day   = String(now.getDate()).padStart(2, "0");
    const hour  = String(now.getHours()).padStart(2, "0");

    const comboDate = new Date(`${year}-${month}-${day}T${hour}:00:00.000Z`);
    const dateOnly  = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

    // Check if this round already exists
    const exists = await roundsModel.findOne({ combo: comboDate });
    if (exists) {
      console.log(`[Round Cron] Round ${comboDate.toISOString()} already exists`);
      return;
    }

    // Find latest roundId and increment
    const lastRound = await roundsModel.findOne().sort({ roundId: -1 }).lean();
    const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

    // Create new round
    await roundsModel.create({
      date:    dateOnly,
      time:    comboDate,
      combo:   comboDate,
      roundId: nextRoundId,
    });

    console.log(`[Round Cron] Created round ${comboDate.toISOString()} with roundId ${nextRoundId}`);
  } catch (err) {
    console.error("[Round Cron] Error:", err.message);
  }
});

cron.schedule("* * * * *", async () => {
  try {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day   = String(now.getDate()).padStart(2, "0");
    const hour  = String(now.getHours()).padStart(2, "0");

    const comboDate = new Date(`${year}-${month}-${day}T${hour}:00:00.000Z`);
    const dateOnly  = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

    const round = await roundsModel.findOne({
      date: dateOnly,
      time : comboDate,
      isClosed: false
    });

    console.log(`round ${JSON.stringify(round)}`)

    if (!round) return;

    const winningCardId = round.cardId;
    const bets = await betModel.find({ roundId: round._id });

    const bulkUsers = [];
    const bulkBets  = [];
    const history   = [];

    for (const bet of bets) {
      const win = bet.cardId.toString() === winningCardId.toString();
      const credit = win ? bet.amount * 10 : -bet.amount;

      bulkBets.push({
        updateOne: { filter: { _id: bet._id }, update: { $set: { status: win ? "win" : "loss" } } }
      });

      bulkUsers.push({
        updateOne: { filter: { _id: bet.userId }, update: { $inc: { demoCoins: credit } } }
      });

      history.push({
        userId: bet.userId,
        roundId: round._id,
        betId: bet._id,
        result: win ? "win" : "loss",
        amount: credit,
        createdAt: new Date()
      });
    }

    await Promise.all([
      User.bulkWrite(bulkUsers),
      betModel.bulkWrite(bulkBets),
      // History.insertMany(history)
    ]);

    round.isClosed = true;
    await round.save();
  } catch (err) {
    console.error("[CRON] evaluate-last-hour error:", err);
  }
})
