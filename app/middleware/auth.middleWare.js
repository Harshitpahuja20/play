const jwt = require("jsonwebtoken");
const userModel = require("../model/user.model");
const { responsestatusmessage } = require("./responses");

const jwt_secret = process.env.JWT_SECRET || 'SUPER_SECRET';

exports.authUser = async (req, res, next) => {
  try {
    const token = req.header("authorization");
    if (!token) return responsestatusmessage(res, false, "Token not found");

    const decoded = jwt.verify(token, jwt_secret);
    const user = await userModel.findById(decoded.id).select("-otp -__v");

    if (!user || user.role !== "user") {
      return responsestatusmessage(res, false, "Unauthorized User");
    }

    req.user = user;
    next();
  } catch (err) {
    return responsestatusmessage(res, false, "Invalid token");
  }
};

exports.authAdmin = async (req, res, next) => {
  try {
    const token = req.header("authorization");
    console.log(token)
    if (!token) return responsestatusmessage(res, false, "Token not found");

    const decoded = jwt.verify(token, jwt_secret);
    const user = await userModel.findById(decoded.id).select("-otp -__v");

    if (!user || user.role !== "admin") {
      return responsestatusmessage(res, false, "Unauthorized Admin");
    }

    req.user = user;
    next();
  } catch (err) {
    return responsestatusmessage(res, false, "Invalid token");
  }
};
