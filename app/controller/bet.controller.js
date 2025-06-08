const Bet   = require("../model/bet.model");          // adjust path
const Card  = require("../model/card.model");         // used only for sanity check
const Round = require("../model/rounds.model");       // sanity check

const {
  responsestatusdata,
  responsestatusmessage,
} = require("../middleware/responses");
const { default: mongoose } = require("mongoose");
const User = require("../model/user.model");

/*───────────────────────────────────────────────────────────────────
  PLACE BET with balance check & atomic deduction
───────────────────────────────────────────────────────────────────*/
exports.placeBet = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { betAmount, cardId, roundId } = req.body;
    const userId = req.user?._id || req.body.userId;

    /* ── validation ───────────────────────────────────────────────*/
    if (!betAmount || betAmount <= 0)
      return responsestatusmessage(res, false, "Bet amount is required.");
    if (!cardId)  return responsestatusmessage(res, false, "cardId is required.");
    if (!roundId) return responsestatusmessage(res, false, "roundId is required.");
    if (!userId)  return responsestatusmessage(res, false, "userId is required.");

    const [cardExists, roundExists] = await Promise.all([
      Card.exists({ _id: cardId }),
      Round.exists({ _id: roundId }),
    ]);
    console.log(JSON.stringify(roundExists))
    if (!cardExists) return responsestatusmessage(res, false, "Card not found.");
    if (!roundExists) return responsestatusmessage(res, false, "Round not found.");
    if (roundExists?.isClosed) return responsestatusmessage(res, false, "Bet Closed.");

    /* ── fetch user & balance check inside the session ────────────*/
    const user = await User.findById(userId).session(session);
    if (!user) return responsestatusmessage(res, false, "User not found.");

    if (user.balance < betAmount) {
      await session.abortTransaction();
      return responsestatusmessage(res, false, "Insufficient balance.");
    }

    /* ── deduct balance & create bet atomically ───────────────────*/
    user.balance -= betAmount;
    await user.save({ session });

    const newBet = await Bet.create(
      [
        {
          betAmount,
          cardId,
          roundId,
          userId,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return responsestatusdata(res, true, "Bet placed successfully", newBet[0]);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("[placeBet] error:", err);
    return responsestatusmessage(res, false, "Error placing bet.");
  }
};

/*───────────────────────────────────────────────────────────────────
  2.  GET ALL BETS OF ONE USER
───────────────────────────────────────────────────────────────────*/
exports.getUserBets = async (req, res) => {
  try {
    const userId = req.params.userId || req.user?._id;
    if (!userId) return responsestatusmessage(res, false, "userId is required.");

    // No limit, no pagination – returns everything
    const bets = await Bet.find({ userId })
      .populate("cardId",   "name image")     // optional: card info
      .populate("roundId",  "combo")          // optional: round info
      .sort({ createdAt: -1 });

    return responsestatusdata(res, true, "User bets fetched", bets);
  } catch (err) {
    console.error("[getUserBets] error:", err);
    return responsestatusmessage(res, false, "Error fetching user bets.");
  }
};

/*───────────────────────────────────────────────────────────────────
  3.  GET *ALL* BETS (admin)
───────────────────────────────────────────────────────────────────*/
exports.getAllBets = async (_req, res) => {
  try {
    const bets = await Bet.find({})
      .populate("userId",  "name email")      // adjust fields
      .populate("cardId",  "name image")
      .populate("roundId", "combo")
      .sort({ createdAt: -1 });

    return responsestatusdata(res, true, "All bets fetched", bets);
  } catch (err) {
    console.error("[getAllBets] error:", err);
    return responsestatusmessage(res, false, "Error fetching bets.");
  }
};
