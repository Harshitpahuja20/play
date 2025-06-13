const upload = require("../middleware/multer.middleware"); // update with actual path
const Card = require("../model/card.model"); // update with actual path
const {
  responsestatusmessage,
  responsestatusdata,
} = require("../middleware/responses"); // update path accordingly
const crypto = require("crypto");
const roundsModel = require("../model/rounds.model");
const {
  getUTCNow,
  getCurrentRoundComboUTC,
  getPreviousRoundComboUTC,
  getNextRoundComboUTC,
} = require('../cron/roundcreator');


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
    // Get UTC-based timestamps
    const nowUTC = getUTCNow();
    const currentRoundId = getCurrentRoundComboUTC();
    const previousRoundId = getPreviousRoundComboUTC();
    const nextRoundId = getNextRoundComboUTC();

    // Convert them to IST just for display
    const nowIST = moment.utc(nowUTC).tz("Asia/Kolkata");
    const currentRoundIST = moment.utc(currentRoundId).tz("Asia/Kolkata");
    const previousRoundIST = moment.utc(previousRoundId).tz("Asia/Kolkata");
    const nextRoundIST = moment.utc(nextRoundId).tz("Asia/Kolkata");

    // Fetch data
    const [cards, currentRound, previousRoundAgg] = await Promise.all([
      Card.find().sort({ createdAt: 1 }),
      roundsModel.findOne({ combo: currentRoundId }),
      roundsModel.aggregate([
        { $match: { combo: previousRoundId } },
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

    return responsestatusdata(res, true, "Cards retrieved successfully", {
      cards,
      currentRound,
      previousRound: previousRoundAgg.length > 0 ? previousRoundAgg[0] : null,
      serverTime: {
        utc: nowUTC.toISOString(),
        ist: nowIST.format(), // "2025-06-13T13:30:00+05:30"
        timestamp: nowUTC.getTime(),
      },
      roundInfo: {
        currentRoundIdUTC: currentRoundId.toISOString(),
        currentRoundIdIST: currentRoundIST.format(),
        previousRoundIdUTC: previousRoundId.toISOString(),
        previousRoundIdIST: previousRoundIST.format(),
        nextRoundStartsIST: nextRoundIST.format(),
      },
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

function getCurrentRoundStatus(round, istNow) {
  if (!round) return 'not_found';
  
  const roundTime = new Date(round.combo);
  const closeTime = new Date(roundTime.getTime() + (55 * 60 * 1000)); // +55 minutes
  const processTime = new Date(roundTime.getTime() + (59 * 60 * 1000)); // +59 minutes
  
  if (istNow < closeTime) {
    return 'betting_open';
  } else if (istNow >= closeTime && istNow < processTime) {
    return 'betting_closed';
  } else if (istNow >= processTime && !round.isProcessed) {
    return 'processing';
  } else if (round.isProcessed) {
    return 'completed';
  }
  
  return 'unknown';
}

// Helper function to get next round start time
function getNextRoundStartTime(istNow) {
  const nextHour = new Date(istNow);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  return nextHour;
}

// Alternative function for getting rounds by date range (IST)
exports.getRoundsByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const istNow = getISTDate();
    
    // Parse dates as IST
    const start = startDate ? new Date(startDate) : new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate());
    const end = endDate ? new Date(endDate) : new Date(start.getTime() + (24 * 60 * 60 * 1000));
    
    console.log('Date range query (IST):', start.toISOString(), 'to', end.toISOString());
    
    const rounds = await roundsModel.find({
      date: {
        $gte: start,
        $lt: end
      }
    }).populate('cardId').sort({ combo: -1 });
    
    return responsestatusdata(res, true, "Rounds retrieved successfully", {
      rounds,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString()
      },
      serverTime: istNow.toISOString()
    });
  } catch (error) {
    console.error('Error in getRoundsByDateRange:', error);
    return responsestatusmessage(res, false, "Something went wrong.");
  }
};

function generateImageName(originalName) {
  const dateStr = new Date().toISOString().replace(/[-:TZ.]/g, ""); // e.g., 20250503124700
  const randomStr = crypto.randomBytes(3).toString("hex"); // 6 characters
  const extension = originalName.substring(originalName.lastIndexOf(".")); // keep .jpg, .png, etc.
  return `img${dateStr}${randomStr}${extension}`;
}

// function getCurrentRoundId(now = new Date()) {
//   const istNow = getISTDate(now);

//   // Set minutes and seconds to 0 to get the current hour boundary
//   const roundTime = new Date(istNow);
//   roundTime.setMinutes(0, 0, 0);

//   // Convert back to UTC for storage
//   const utcRoundTime = new Date(roundTime.getTime() - 5.5 * 60 * 60 * 1000);
//   return utcRoundTime;
// }

// function getPreviousRoundId(now = new Date()) {
//   const istNow = getISTDate(now);

//   // Set to previous hour boundary
//   const prevRoundTime = new Date(istNow);
//   prevRoundTime.setMinutes(0, 0, 0);
//   prevRoundTime.setHours(prevRoundTime.getHours() - 1);

//   // Convert back to UTC for storage
//   const utcPrevRoundTime = new Date(
//     prevRoundTime.getTime() - 5.5 * 60 * 60 * 1000
//   );
//   return utcPrevRoundTime;
// }