const {
  responsestatusdata,
  responsestatusmessage,
} = require("../middleware/responses");
const roundsModel = require("../model/rounds.model");

exports.getAllRounds = async (req, res) => {
  try {
    const { date } = req.query;

    // Use query date or default to today
    const selectedDate = date ? new Date(date) : new Date();

    // Ensure we get only the day's range in UTC
    const startOfDay = new Date(selectedDate.setUTCHours(0, 0, 0, 0));
    const endOfDay = new Date(
      new Date(startOfDay).setUTCHours(23, 59, 59, 999)
    );

    const rounds = await roundsModel.aggregate([
      {
        $match: {
          date: { $gte: startOfDay, $lte: endOfDay },
        },
      },
      {
        $lookup: {
          from: "cards",
          localField: "cardId",
          foreignField: "_id",
          as: "card",
        },
      },
      { $unwind: { path: "$card", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "bets",
          let: { roundId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$roundId", "$$roundId"] } } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ],
          as: "betsInfo",
        },
      },
      {
        $addFields: {
          totalBet: {
            $ifNull: [{ $arrayElemAt: ["$betsInfo.total", 0] }, 0],
          },
        },
      },
      { $project: { betsInfo: 0 } }, // hide helper array
      { $sort: { time: -1 } },
    ]);
    // Sort by time for chronological order

    return responsestatusdata(res, true, "Rounds fetched successfully", rounds);
  } catch (err) {
    return responsestatusmessage(
      res,
      false,
      err?.message || "Failed to fetch rounds"
    );
  }
};

exports.updateResult = async (req, res) => {
  const { roundId, cardId } = req.body;

  const round = await roundsModel.findById(roundId);
  if (!round) {
    return responsestatusmessage(
      res,
      false,
      "Round not found! try again after refrshing"
    );
  }
  round.cardId = cardId;
  await round.save();
  return responsestatusmessage(res, true, "Result Updated!");
};
