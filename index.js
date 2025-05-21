const express = require("express");
const path = require("path");
const cors = require("cors");
const mongoose = require("mongoose");
const userRoutes = require("./app/routes/all.routes");
require("dotenv").config()
require("./app/cron/roundcreator")

const app = express();

app.use(express.json());
app.use(cors());

app.use("/api", userRoutes);
app.use("/", express.static(path.join(__dirname, "public", "uploads")));

mongoose
  .connect(process.env.MONGO_DB || "mongodb://localhost:27017/taash")
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error(err));

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
