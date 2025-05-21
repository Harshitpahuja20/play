const mongoose = require("mongoose");

const roundSchema = new mongoose.Schema(
  {
    date: {
      type: Date, // e.g., 2025-05-15T00:00:00.000Z
      required: true,
    },
    time: {
      type: Date, // e.g., 2025-05-15T14:00:00.000Z
      required: true,
    },
    combo: {
      type: Date, // same as `time`, stored as full date+hour
      required: true,
    },
    isClosed: {
      type: Boolean,
      default: false,
    },
    roundId: {
      type: Number,
    },
    cardId: {
      type: mongoose.Types.ObjectId,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Round", roundSchema);
