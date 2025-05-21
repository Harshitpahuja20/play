const express = require("express");
const {
  sendOtp,
  verifyOtp,
  login,
  adminlogin,
  getCurrentRole,
  getAllUsers,
} = require("../controller/user.controller");
const {
  addCard,
  getCards,
  getAdminCards,
} = require("../controller/card.controller");
const { authAdmin, authUser } = require("../middleware/auth.middleWare");
const {
  placeBet,
  getUserBets,
  getAllBets,
} = require("../controller/bet.controller");
const {
  getAllRounds,
  updateResult,
} = require("../controller/round.controller");
const { addBalance } = require("../controller/transaction.controller");
const { getStatistics } = require("../controller/dashbaord.controller");

const router = express.Router();

// user routes
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/login", login);
router.post("/adminlogin", adminlogin);
router.get("/getCurrentRole", getCurrentRole);
router.get("/getAllUsers", getAllUsers);

// card routes
router.post("/addCard", authAdmin, addCard);
router.get("/getCards", getCards);
router.get("/getAdminCards", getAdminCards);

// bet routes
router.post("/bet",authUser, placeBet); // place a bet
router.get("/bets", authUser, getUserBets); // user history
router.get("/bets", getAllBets);

// round routes
router.get("/getAllRounds", getAllRounds);
router.put("/updateResult", updateResult);

// round routes
router.get("/addBalance", addBalance);

// statistics routes
router.get("/getStatistics", getStatistics);

module.exports = router;
