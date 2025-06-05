const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,

      min: 0,
    },
    type: {
      type: String,
      enum: ["deposit", "withdraw"],
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    handledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // or "Admin" if you use a separate model
    },
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },
    method: {
      type: String,
      enum: ["cash", "bank", "upi", "wallet", "bonus"],
      default: "cash",
    },
    remarks: {
      type: String,
      default: "",
    },
    referenceId: {
      type: String,
      default: "",
    },
    upiId: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);
