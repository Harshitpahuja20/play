const upload = require("../middleware/multer.middleware"); // update with actual path
const Card = require("../model/card.model"); // update with actual path
const {
  responsestatusmessage,
  responsestatusdata,
} = require("../middleware/responses"); // update path accordingly
const crypto = require("crypto");

exports.addCard = async (req, res) => {
  // Call the upload middleware for 'card' field
  upload.single("card")(req, res, async () => {
    try {
      const { name } = req.body;
      console.log(name , req.file)
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
  },
)}

exports.getCards = async (req, res) => {
  try {
    const cards = await Card.find();

    if (!cards || cards.length === 0) {
      return responsestatusmessage(res, "error", "No cards found.");
    }

    return responsestatusdata(res, "success", "Cards retrieved successfully", cards);
  } catch (error) {
    console.error(error);
    return responsestatusmessage(res, "error", "Something went wrong.");
  }
};

function generateImageName(originalName) {
  const dateStr = new Date().toISOString().replace(/[-:TZ.]/g, ""); // e.g., 20250503124700
  const randomStr = crypto.randomBytes(3).toString("hex"); // 6 characters
  const extension = originalName.substring(originalName.lastIndexOf(".")); // keep .jpg, .png, etc.
  return `img${dateStr}${randomStr}${extension}`;
}
