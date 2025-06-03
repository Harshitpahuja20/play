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
const { addBalance, getUserTransactions, getWithdrawRequests, WithdrawRequest } = require("../controller/transaction.controller");
const { getStatistics } = require("../controller/dashbaord.controller");
const { getContent } = require("../controller/Content.controller");

const router = express.Router();

// user routes
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/login", login);
router.post("/adminlogin", adminlogin);
router.get("/getCurrentRole",authAdmin, getCurrentRole);
router.get("/getAllUsers", authAdmin , getAllUsers);

// card routes
router.post("/addCard", authAdmin, addCard);
router.get("/getCards", getCards);
router.get("/getAdminCards",authAdmin, getAdminCards);

// bet routes
router.post("/bet",authUser, placeBet); // place a bet
router.get("/bets", authUser, getUserBets); // user history
router.get("/bets", getAllBets);

// round routes
router.get("/getAllRounds",authAdmin, getAllRounds);
router.put("/updateResult",authAdmin, updateResult);

// balance routes
router.post("/addBalance",authAdmin, addBalance);
router.get("/getWithdrawRequests",authAdmin, getWithdrawRequests);
router.get("/getUserTransactions",authUser, getUserTransactions);
router.post("/requestWithdraw",authUser, WithdrawRequest);

// statistics routes
router.get("/getStatistics",authAdmin, getStatistics);

// content routes
router.get("/getContent", getContent);

module.exports = router;
