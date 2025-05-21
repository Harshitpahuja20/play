const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

const betSchema = new Schema(
  {
    /** Amount the user stakes (store in smallest currency unit or Number) */
    betAmount: {
      type: Number,
      min: 0,
    },

    /** Card that the user bet on */
    cardId: {
      type: mongoose.Types.ObjectId,
      ref: "Card", // ← adjust to your actual card model name
    },

    /** Bettor */
    userId: {
      type: mongoose.Types.ObjectId,
      ref: "User", // ← adjust to your actual user model name
    },

    /** Hourly (or other) round in which the bet was placed */
    roundId: {
      type: mongoose.Types.ObjectId,
      ref: "Round",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Bet", betSchema);
