const mongoose = require("mongoose");
const { responsestatusmessage } = require("../middleware/responses");
const User = require("../model/user.model");
const Transaction = require("../model/transactionModel");

exports.addBalance = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, userId, remarks, referenceId } = req.body;

    if (!amount || isNaN(amount)) {
      return responsestatusmessage(res, false, "Valid amount is required");
    }

    const bonusInfo = {
      amount,
      type: "deposit",
      method: "bonus",
      remarks: remarks || "Admin Bonus",
      referenceId: referenceId || "BONUS-" + Date.now(),
      depositedBy: req.user._id, // Admin user ID
      status: "success",
    };

    if (userId) {
      // Bonus for a specific user
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        return responsestatusmessage(res, false, "User not found");
      }

      user.balance += amount;
      await user.save({ session });

      await transactionModel.create([{ ...bonusInfo, userId }], { session });
    } else {
      // Bonus for all verified users (except admin)
      const users = await User.find({
        isVerified: true,
        role: { $ne: "admin" },
      }).session(session);

      if (!users.length) {
        await session.abortTransaction();
        return responsestatusmessage(res, false, "No users found for bonus");
      }

      const transactions = users.map((user) => ({
        ...bonusInfo,
        userId: user._id,
      }));

      const bulkOps = users.map((user) => ({
        updateOne: {
          filter: { _id: user._id },
          update: { $inc: { balance: amount } },
        },
      }));

      await User.bulkWrite(bulkOps, { session });
      await Transaction.insertMany(transactions, { session });
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
