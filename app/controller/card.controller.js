const upload = require("../middleware/multer.middleware"); // update with actual path
const Card = require("../model/card.model"); // update with actual path
const {
  responsestatusmessage,
  responsestatusdata,
} = require("../middleware/responses"); // update path accordingly
const crypto = require("crypto");
const roundsModel = require("../model/rounds.model");

exports.addCard = async (req, res) => {
  // Call the upload middleware for 'card' field
  upload.single("card")(req, res, async () => {
    try {
      const { name } = req.body;
      console.log(name, req.file);
      if (!name || !req.file) {
        return responsestatusmessage(
          res,
          "fail",
          "Name and image are required."
        );
      }

      const imagePath = `${req.file.fieldname}/${req.file.generatedName}`;

      const newCard = new Card({
        name,
        image: imagePath,
      });

      await newCard.save();

      return responsestatusdata(
        res,
        "success",
        "Card added successfully",
        newCard
      );
    } catch (error) {
      console.error(error);
      return responsestatusmessage(res, "fail", "Something went wrong.");
    }
  });
};

exports.getCards = async (req, res) => {
  try {
    const cards = await Card.find();
    const currentRoundId = getCurrentRoundId(); // "2025-05-17T14:00:00.000Z"
    console.log(currentRoundId);
    const currentRound = await roundsModel.findOne({
      combo: new Date(currentRoundId),
    });

    if (!cards || cards.length === 0) {
      fail;
      return responsestatusmessage(res, "fail", "No cards found.");
    }

    return responsestatusdata(res, "success", "Cards retrieved successfully", {
      cards,
      currentRound,
    });
  } catch (error) {
    console.error(error);
    return responsestatusmessage(res, "fail", "Something went wrong.");
  }
};

exports.getAdminCards = async (req, res) => {
  try {
    const cards = await Card.find();

    if (!cards || cards.length === 0) {
      fail;
      return responsestatusmessage(res, "fail", "No cards found.");
    }

    return responsestatusdata(
      res,
      "success",
      "Cards retrieved successfully",
      cards
    );
  } catch (error) {
    console.error(error);
    return responsestatusmessage(res, "fail", "Something went wrong.");
  }
};

function generateImageName(originalName) {
  const dateStr = new Date().toISOString().replace(/[-:TZ.]/g, ""); // e.g., 20250503124700
  const randomStr = crypto.randomBytes(3).toString("hex"); // 6 characters
  const extension = originalName.substring(originalName.lastIndexOf(".")); // keep .jpg, .png, etc.
  return `img${dateStr}${randomStr}${extension}`;
}

function getCurrentRoundId(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:00:00.000Z`;
}
