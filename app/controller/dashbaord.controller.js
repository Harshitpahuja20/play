const userModel = require("../model/user.model");
const betModel = require("../model/bet.model");
const roundsModel = require("../model/rounds.model");
const cardModel = require("../model/card.model");
const { responsestatusdata } = require("../middleware/responses");

exports.getStatistics = async (req, res) => {
  try {
    const [verifiedUsers, totalBets, totalRounds, totalCards] =
      await Promise.all([
        userModel.countDocuments({ isVerified: true, role: { $ne: "admin" } }),
        betModel.countDocuments({}),
        roundsModel.countDocuments({}),
        cardModel.countDocuments({}),
      ]);

    responsestatusdata(res, true, "Statistics", {
      verifiedUsers,
      totalBets,
      totalRounds,
      totalCards,
    });
  } catch (err) {
    responsestatusdata(res, false, err.message || "Server error", null, 500);
  }
};
