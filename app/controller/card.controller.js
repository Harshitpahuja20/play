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
          false,
          "Name and image are required."
        );
      }

      const imagePath = `${req.file.fieldname}/${req.file.generatedName}`;

      const newCard = new Card({
        name,
        image: imagePath,
      });

      await newCard.save();

      return responsestatusdata(res, true, "Card added successfully", newCard);
    } catch (error) {
      console.error(error);
      return responsestatusmessage(res, false, "Something went wrong.");
    }
  });
};

exports.getCards = async (req, res) => {
  try {
    // Run independent queries concurrently for better speed
    const currentRoundId = new Date(getCurrentRoundId());
    const previousRoundId = new Date(getPreviousRoundId());

    console.log(currentRoundId);
    console.log(previousRoundId);

    const [cards, currentRound, previousRound] = await Promise.all([
      Card.find().sort({ createdAt: 1 }),
      roundsModel.findOne({ combo: currentRoundId }),
      roundsModel.aggregate([
        {
          $match: { combo: previousRoundId },
        },
        {
          $lookup: {
            from: "cards",
            localField: "cardId",
            foreignField: "_id",
            as: "card",
          },
        },
        { $unwind: { path: "$card", preserveNullAndEmptyArrays: true } },
      ]),
    ]);
    if (!cards || cards.length === 0) {
      return responsestatusmessage(res, false, "No cards found.");
    }

    // Format previousRound data for consistent shape (optional)
    const formattedPreviousRound = previousRound?.length
      ? {
          _id: previousRound[0]?._id,
          image: previousRound[0]?.card?.image || null,
          name: previousRound[0]?.card?.name || null,
        }
      : null;



    return responsestatusdata(res, true, "Cards retrieved successfully", {
      cards,
      currentRound,
      previousRound: formattedPreviousRound,
    });
  } catch (error) {
    console.error(error);
    return responsestatusmessage(res, false, "Something went wrong.");
  }
};

exports.getAdminCards = async (req, res) => {
  try {
    const cards = await Card.find();

    if (!cards || cards.length === 0) {
      fail;
      return responsestatusmessage(res, false, "No cards found.");
    }

    return responsestatusdata(res, true, "Cards retrieved successfully", cards);
  } catch (error) {
    console.error(error);
    return responsestatusmessage(res, false, "Something went wrong.");
  }
};

function generateImageName(originalName) {
  const dateStr = new Date().toISOString().replace(/[-:TZ.]/g, ""); // e.g., 20250503124700
  const randomStr = crypto.randomBytes(3).toString("hex"); // 6 characters
  const extension = originalName.substring(originalName.lastIndexOf(".")); // keep .jpg, .png, etc.
  return `img${dateStr}${randomStr}${extension}`;
}

function getCurrentRoundId(now = new Date()) {
  // Adjust the time for IST
  now.setUTCHours(now.getUTCHours());

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:00:00.000Z`;
}

function getPreviousRoundId(now = new Date()) {
  // Clone the date and adjust the time for IST
  const prevHourDate = new Date(now);
  prevHourDate.setUTCHours(prevHourDate.getUTCHours());

  // Subtract one hour from the adjusted time
  prevHourDate.setHours(prevHourDate.getHours() - 1);

  const year = prevHourDate.getFullYear();
  const month = String(prevHourDate.getMonth() + 1).padStart(2, "0");
  const day = String(prevHourDate.getDate()).padStart(2, "0");
  const hour = String(prevHourDate.getHours()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:00:00.000Z`;
}
