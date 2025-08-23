const mongoose = require("mongoose");
const {
  responsestatusmessage,
  responsestatusdata,
} = require("../middleware/responses");
const User = require("../model/user.model");
const Transaction = require("../model/transactionModel");

exports.addBalance = async (req, res) => {
  const role = req.user.role;
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
      handledBy: req.user._id, // Admin / Subadmin ID
      status: "success",
    };

    // === Subadmin logic ===
    if (role === "subadmin") {
      if (!userId) {
        await session.abortTransaction();
        session.endSession();
        return responsestatusmessage(
          res,
          false,
          "Subadmins can only add balance to a single user"
        );
      }

      // Check if subadmin has enough balance
      const subadmin = await User.findById(req.user._id).session(session);
      if (!subadmin) {
        await session.abortTransaction();
        session.endSession();
        return responsestatusmessage(res, false, "Subadmin not found");
      }

      if (subadmin.balance < amount) {
        await session.abortTransaction();
        session.endSession();
        return responsestatusmessage(
          res,
          false,
          "Insufficient balance in subadmin account"
        );
      }

      // Deduct from subadmin balance
      subadmin.balance -= Number(amount);
      await subadmin.save({ session });

      // Credit to target user
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return responsestatusmessage(res, false, "User not found");
      }

      user.balance += Number(amount);
      await user.save({ session });

      // Create transaction record
      await Transaction.create([{ ...bonusInfo, userId }], { session });
    }

    // === Admin logic ===
    else if (role === "admin") {
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
      createdAt: { $gt: user?.createdAt || new Date(0) },
    };
  } else if (type === "withdraw") {
    matchConditions = {
      type,
      userId: userIdObj,
      createdAt: { $gt: user?.createdAt || new Date(0) },
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

exports.getSubAdminUsers = async (req, res) => {
  const subadminId = req.user._id;

  try {
    const transactions = await Transaction.aggregate([
      {
        $match: {
          handledBy: subadminId, // transactions created by this subadmin
          userId: { $exists: true, $ne: null }, // only user transactions
        },
      },
      {
        $group: {
          _id: "$userId", // group by userId
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 0,
          userId: "$user._id",
          fullName: "$user.fullName",
          phoneNumber: "$user.phoneNumber",
          balance: "$user.balance",
        },
      },
    ]);

    if (!transactions.length) {
      return responsestatusmessage(res, false, "Requests not found!");
    }

    return responsestatusdata(res, true, "Transactions Found", transactions);
  } catch (error) {
    console.error(error);
    return responsestatusmessage(res, false, "Error fetching transactions");
  }
};

exports.withdraw = async (req, res) => {
  const role = req.user.role;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, userId } = req.body;

    if (!amount || isNaN(amount)) {
      await session.abortTransaction();
      session.endSession();
      return responsestatusmessage(res, false, "Valid amount is required");
    }

    if (!userId) {
      await session.abortTransaction();
      session.endSession();
      return responsestatusmessage(res, false, "UserId is required for withdraw");
    }

    // Common transaction info
    const withdrawInfo = {
      amount,
      type: "withdraw",
      method: "cash",
      handledBy: req.user._id, // Who triggered it (admin/subadmin)
      status: "success",
      userId,
    };

    // === Subadmin logic ===
    if (role === "subadmin") {
      // Subadmin gets the withdrawn money
      const subadmin = await User.findById(req.user._id).session(session);
      if (!subadmin) {
        await session.abortTransaction();
        session.endSession();
        return responsestatusmessage(res, false, "Subadmin not found");
      }

      // Check if user exists
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return responsestatusmessage(res, false, "User not found");
      }

      // Check if user has enough balance
      if (user.balance < amount) {
        await session.abortTransaction();
        session.endSession();
        return responsestatusmessage(res, false, "Insufficient user balance");
      }

      // Deduct from user
      user.balance -= Number(amount);
      await user.save({ session });

      // Credit to subadmin
      subadmin.balance += Number(amount);
      await subadmin.save({ session });

      // Create transaction record
      await Transaction.create([withdrawInfo], { session });
    }

    // === Admin logic ===
    else if (role === "admin") {
      // Admin can withdraw from user (but money just "goes to system")
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return responsestatusmessage(res, false, "User not found");
      }

      if (user.balance < amount) {
        await session.abortTransaction();
        session.endSession();
        return responsestatusmessage(res, false, "Insufficient user balance");
      }

      user.balance -= Number(amount);
      await user.save({ session });

      await Transaction.create([withdrawInfo], { session });
    }

    await session.commitTransaction();
    session.endSession();

    return responsestatusmessage(res, true, "Withdraw successful");
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
