const mongoose = require("mongoose");
const {
  responsestatusmessage,
  responsestatusdata,
} = require("../middleware/responses");
const User = require("../model/user.model");
const Transaction = require("../model/transactionModel");

exports.addBalance = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, userId } = req.body;

    if (!amount || isNaN(amount)) {
      await session.abortTransaction();
      session.endSession();
      return responsestatusmessage(res, false, "Valid amount is required");
    }

    const bonusInfo = {
      amount,
      type: "deposit",
      method: userId ? "cash" : "bonus",
      handledBy: req.user._id, // Admin user ID
      status: "success",
    };

    if (userId) {
      // Bonus for specific user
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return responsestatusmessage(res, false, "User not found");
      }

      user.balance += Number(amount);
      await user.save({ session });

      await Transaction.create([{ ...bonusInfo, userId }], { session });
    } else {
      // Bonus for all verified users except admins
      const result = await User.updateMany(
        { isVerified: true, role: { $ne: "admin" } },
        { $inc: { balance: amount } },
        { session }
      );

      if (result.matchedCount === 0) {
        await session.abortTransaction();
        session.endSession();
        return responsestatusmessage(res, false, "No users found for bonus");
      }

      // Create only one transaction without userId
      await Transaction.create([{ ...bonusInfo }], { session });
    }

    await session.commitTransaction();
    session.endSession();

    return responsestatusmessage(res, true, "Bonus distributed successfully");
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return responsestatusmessage(
      res,
      false,
      err.message || "Something went wrong"
    );
  }
};

exports.getUserTransactions = async (req, res) => {
  const user = req?.user;
  const { type } = req.query;

  if (!type) {
    return responsestatusmessage(res, false, "Type not found!");
  }

  const userIdObj = new mongoose.Types.ObjectId(user._id);
  let matchConditions = {};

  if (type === "deposit") {
    matchConditions = {
      type,
      $or: [{ userId: { $exists: false } }, { userId: userIdObj }],
    };
  } else if (type === "withdraw") {
    matchConditions = {
      type,
      userId: userIdObj,
    };
  }

  try {
    const transactions = await Transaction.aggregate([
      {
        $match: matchConditions,
      },
    ]);

    return responsestatusdata(res, true, "User Transactions", transactions);
  } catch (error) {
    console.error(error);
    return responsestatusmessage(res, false, "Something went wrong!");
  }
};

exports.WithdrawRequest = async (req, res) => {
  const user = req.user;
  const { amount, upiId } = req.body;

  if (Number(user?.balance) < Number(amount)) {
    return responsestatusmessage(
      res,
      false,
      "Your Balance is lower than your withdrawal request!"
    );
  }

  // Deduct amount from user balance and save
  user.balance = Number(user.balance) - Number(amount);
  await user.save();

  // Create withdrawal transaction
  const transaction = await Transaction.create({
    amount,
    upiId,
    type: "withdraw",
    method: "upi",
    userId: user?._id,
    status: "pending", // optional: mark as pending until processed
  });

  // Return response with updated balance and transaction
  return responsestatusdata(
    res,
    true,
    "Withdrawal request submitted successfully",
    { pendingBalance: user.balance, transaction }
  );
};

exports.getWithdrawRequests = async (req, res) => {
  const transactions = await Transaction.aggregate([
    {
      type: "withdraw",
      status: "pending",
    },
  ]);

  if (!transaction) {
    return responsestatusmessage(res, false, "Requests not found!");
  }
  return responsestatusmessage(res, true, "Transactions Found", transactions);
};
