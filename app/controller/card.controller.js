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
    // Get current and previous round IDs using the corrected functions
    const currentRoundId = getCurrentRoundId();
    const previousRoundId = getPreviousRoundId();
    
    console.log('Current Round ID:', currentRoundId.toISOString());
    console.log('Previous Round ID:', previousRoundId.toISOString());
    console.log('Current IST Time:', getISTDate().toISOString());
    
    // Run independent queries concurrently for better speed
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

    // Format previousRound data for consistent shape
    const formattedPreviousRound = previousRound?.length
      ? {
          _id: previousRound[0]?._id,
          roundId: previousRound[0]?.roundId,
          image: previousRound[0]?.card?.image || null,
          name: previousRound[0]?.card?.name || null,
          cardId: previousRound[0]?.cardId || null,
          combo: previousRound[0]?.combo || null,
          isClosed: previousRound[0]?.isClosed || false,
        }
      : null;

    // Add some debug info for current round
    const formattedCurrentRound = currentRound ? {
      ...currentRound.toObject(),
      istTime: getISTDate(currentRound.combo).toISOString(),
    } : null;

    return responsestatusdata(res, true, "Cards retrieved successfully", {
      cards,
      currentRound: formattedCurrentRound,
      previousRound: formattedPreviousRound,
      debug: {
        currentRoundId: currentRoundId.toISOString(),
        previousRoundId: previousRoundId.toISOString(),
        currentISTTime: getISTDate().toISOString(),
      }
    });
  } catch (error) {
    console.error('Error in getCards:', error);
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

function getISTDate(utcDate = new Date()) {
  // Create IST date by adding 5.5 hours to UTC
  const istDate = new Date(utcDate.getTime() + 5.5 * 60 * 60 * 1000);
  return istDate;
}

function getCurrentRoundId(now = new Date()) {
  const istNow = getISTDate(now);

  // Set minutes and seconds to 0 to get the current hour boundary
  const roundTime = new Date(istNow);
  roundTime.setMinutes(0, 0, 0);

  // Convert back to UTC for storage
  const utcRoundTime = new Date(roundTime.getTime() - 5.5 * 60 * 60 * 1000);
  return utcRoundTime;
}

function getPreviousRoundId(now = new Date()) {
  const istNow = getISTDate(now);

  // Set to previous hour boundary
  const prevRoundTime = new Date(istNow);
  prevRoundTime.setMinutes(0, 0, 0);
  prevRoundTime.setHours(prevRoundTime.getHours() - 1);

  // Convert back to UTC for storage
  const utcPrevRoundTime = new Date(
    prevRoundTime.getTime() - 5.5 * 60 * 60 * 1000
  );
  return utcPrevRoundTime;
}

function getNextRoundId(now = new Date()) {
  // Clone the date and adjust the time for IST
  const nextHourDate = new Date(now);
  nextHourDate.setUTCHours(nextHourDate.getUTCHours());

  // Add one hour to the adjusted time
  nextHourDate.setHours(nextHourDate.getHours() + 1);

  const year = nextHourDate.getFullYear();
  const month = String(nextHourDate.getMonth() + 1).padStart(2, "0");
  const day = String(nextHourDate.getDate()).padStart(2, "0");
  const hour = String(nextHourDate.getHours()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:00:00.000Z`;
}
