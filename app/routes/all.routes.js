const express = require('express');
const { sendOtp, verifyOtp, login, adminlogin } = require('../controller/user.controller');
const { addCard, getCards } = require('../controller/card.controller');
const { authAdmin } = require('../middleware/auth.middleWare');

const router = express.Router();


// user routes
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/login', login);
router.post('/adminlogin', adminlogin);

// card routes
router.post('/addCard', authAdmin ,addCard);
router.get('/getCards' ,getCards);


module.exports = router;
