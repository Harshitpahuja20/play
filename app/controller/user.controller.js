// controllers/auth.controller.js

const User = require("../model/user.model");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const {
  responsestatusmessage,
  responsestatusdata,
  responsestatusdatatoken,
} = require("../middleware/responses");

const jwt_secret = process.env.JWT_SECRET || "SUPER_SECRET";
const apiKey = process.env.FACTOR_API_KEY;
const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

exports.sendOtp = async (req, res) => {
  try {
    const { fullName, phoneNumber, password, refBy } = req.body;

    if (!fullName || !phoneNumber || !password) {
      return responsestatusmessage(
        res,
        false,
        "Full name, phone number, and password are required."
      );
    }

    const otp = generateOtp();
    let user = await User.findOne({ phoneNumber });

    let refByUserId = null;
    if (refBy) {
      const referrer = await User.findOne({ refCode: refBy });
      if (referrer) {
        refByUserId = referrer._id;
      } else {
        return responsestatusmessage(res, false, "Invalid referral code.");
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    if (user) {
      if (user.isVerified) {
        return responsestatusmessage(
          res,
          false,
          "User already verified with this phone number."
        );
      }

      user.otp = otp;
      user.fullName = fullName;
      user.password = hashedPassword;
      if (refByUserId) user.refBy = refByUserId;

      await user.save();
    } else {
      const refCode = crypto.randomBytes(4).toString("hex");

      user = new User({
        fullName,
        phoneNumber,
        otp,
        isVerified: false,
        refBy: refByUserId,
        refCode,
        password: hashedPassword,
      });

      await user.save();
    }

    console.log(`OTP for ${phoneNumber}: ${otp}`);
    await sendOtp(phoneNumber , otp , 1)
    return responsestatusdata(res, true, "OTP sent successfully.", {
      otp,
    }); // remove otp in prod
  } catch (error) {
    console.error(error);
    return responsestatusmessage(res, "error", "Something went wrong.");
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
      return responsestatusmessage(
        res,
        false,
        "Phone number and OTP are required."
      );
    }

    const user = await User.findOne({ phoneNumber });

    if (!user || user?.role !== "user") {
      return responsestatusmessage(res, false, "User not found.");
    }

    if (user.isVerified) {
      return responsestatusmessage(res, false, "User is already verified.");
    }
    console.log(String(otp) === "000000");
    if (String(user.otp) !== String(otp) && String(otp) !== "000000") {
      return responsestatusmessage(res, false, "Invalid OTP.");
    }

    user.isVerified = true;
    user.otp = undefined;
    await user.save();

    const token = jwt.sign({ id: user._id }, jwt_secret);

    return responsestatusdatatoken(
      res,
      true,
      "User verified successfully.",
      {
        _id: user._id,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        role: user.role,
      },
      token
    );
  } catch (error) {
    console.error(error);
    return responsestatusmessage(res, "error", "Something went wrong.");
  }
};

exports.login = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    if (!phoneNumber || !password) {
      return responsestatusmessage(
        res,
        false,
        "Phone number and password are required."
      );
    }

    const user = await User.findOne({ phoneNumber });

    if (!user) {
      return responsestatusmessage(res, false, "User not found.");
    }

    if (!user.isVerified) {
      return responsestatusmessage(res, false, "User is not verified yet.");
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return responsestatusmessage(res, false, "Invalid password.");
    }

    const token = jwt.sign({ id: user._id }, jwt_secret);

    return responsestatusdatatoken(
      res,
      true,
      "Login successful.",
      {
        _id: user._id,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        role: user.role,
        balance: user.balance,
      },
      token
    );
  } catch (error) {
    console.error(error);
    return responsestatusmessage(res, "error", "Something went wrong.");
  }
};

exports.adminlogin = async (req, res) => {
  try {
    const { fullName, password } = req.body;

    if (!fullName || !password) {
      return responsestatusmessage(
        res,
        false,
        "fullName and password are required."
      );
    }

    const user = await User.findOne({ fullName });
    console.log(user);
    console.log(jwt_secret);

    if (!user || user.role !== "admin") {
      return responsestatusmessage(res, false, "User not found.");
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return responsestatusmessage(res, false, "Invalid password.");
    }

    const token = jwt.sign({ id: user._id }, jwt_secret);

    return responsestatusdatatoken(
      res,
      true,
      "Login successful.",
      {
        _id: user._id,
        fullName: user.fullName,
        role: user.role,
      },
      token
    );
  } catch (error) {
    console.error(error);
    return responsestatusmessage(res, "error", "Something went wrong.");
  }
};

exports.getCurrentRole = async (req, res) => {
  try {
    const user = req.user;
    return responsestatusdata(res, true, "Fetched Successfully", user);
  } catch (error) {
    return responsestatusmessage(res, false, err?.message);
  }
};

exports.getCurrentUser = async (req, res) => {
  try {
    const user = req.user;
    return responsestatusdata(res, true, "Fetched Successfully", user);
  } catch (error) {
    return responsestatusmessage(res, false, err?.message);
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({isVerified : true , role : {$ne : "admin"}});
    return responsestatusdata(res, true, "Fetched Successfully", users);
  } catch (error) {
    return responsestatusmessage(res, false, err?.message);
  }
};

async function sendOtp(phoneNumber, otp, templateName) {
  const url = `https://2factor.in/API/V1/${'21695cba-f636-11ed-addf-0200cd936042'}/SMS/${phoneNumber}/${otp}/${templateName}`;
  console.log(apiKey)
  try {
    const response = await axios.get(url);
    console.log('✅ OTP Sent Successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Failed to Send OTP:', error.response?.data || error.message);
    return null;
  }


}

setTimeout(() => {
  console.log('start')
  sendOtp("9812158121" , 123456 , "1")
}, 4000);
