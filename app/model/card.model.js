const mongoose = require("mongoose");

const cardSchema = new mongoose.Schema({
  name: { type: String, required: true },
  image: { type: String, required: true }, // store path or filename
});

module.exports = mongoose.model("Card", cardSchema);
