const mongoose = require("mongoose");

const withdrawRequestSchema = new mongoose.Schema(
  {
    amount: { type: String, required: true },
    userId: { type: String, required: true }, // store path or filename
    status: { type: String, default : "pending" },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("WithdrawRequest", withdrawRequestSchema);
