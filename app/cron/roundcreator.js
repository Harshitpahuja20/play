const cron = require("node-cron");
const roundsModel = require("../model/rounds.model");
const betModel = require("../model/bet.model");
const User = require("../model/user.model");
const cardModel = require("../model/card.model");

// Helper functions for IST handling - Everything in IST
function getISTDate(utcDate = new Date()) {
  // Create IST date by adding 5.5 hours to UTC
  const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));
  return istDate;
}

function getCurrentRoundId(now = new Date()) {
  const istNow = getISTDate(now);
  
  // Set minutes and seconds to 0 to get the current hour boundary in IST
  const roundTime = new Date(istNow);
  roundTime.setMinutes(0, 0, 0);
  
  // Return IST time directly (no conversion back to UTC)
  return roundTime;
}

function getNextRoundId(now = new Date()) {
  const istNow = getISTDate(now);
  
  // Set to next hour boundary in IST
  const nextRoundTime = new Date(istNow);
  nextRoundTime.setMinutes(0, 0, 0);
  nextRoundTime.setHours(nextRoundTime.getHours() + 1);
  
  // Return IST time directly
  return nextRoundTime;
}

function getPreviousRoundId(now = new Date()) {
  const istNow = getISTDate(now);
  
  // Set to previous hour boundary in IST
  const prevRoundTime = new Date(istNow);
  prevRoundTime.setMinutes(0, 0, 0);
  prevRoundTime.setHours(prevRoundTime.getHours() - 1);
  
  // Return IST time directly
  return prevRoundTime;
}

function getISTDateOnly(istDate) {
  // Get date-only (YYYY-MM-DD) in IST
  return new Date(istDate.getFullYear(), istDate.getMonth(), istDate.getDate());
}

function logCombo(label, istDate) {
  console.log(`[${label}] IST: ${istDate.toISOString()}`);
}

// CRON at :55 IST — Close the current round if needed
cron.schedule("55 * * * *", async () => {
  const istNow = getISTDate();
  console.log(`\n[CRON 55] Triggered at IST: ${istNow.toISOString()}`);

  try {
    const combo = getCurrentRoundId();
    logCombo("Current Round", combo);

    let round = await roundsModel.findOne({ combo });

    if (!round) {
      const lastRound = await roundsModel.findOne().sort({ createdAt: -1 }).limit(1).lean();
      const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;
      
      await roundsModel.create({
        date: getISTDateOnly(combo),
        time: combo,
        combo,
        roundId: nextRoundId,
        isClosed: true,
        createdAt: istNow, // Store creation time in IST
        updatedAt: istNow
      });

      console.log(`[CRON 55] Round missing — created & closed (roundId: ${nextRoundId}).`);
    } else if (!round.isClosed) {
      round.isClosed = true;
      round.updatedAt = istNow; // Update time in IST
      await round.save();
      console.log("[CRON 55] Closed existing round.");
    } else {
      console.log("[CRON 55] Round already closed.");
    }
  } catch (err) {
    console.error(`[CRON 55] Error: ${err.message}`);
  }
});

// CRON at :00 IST — Create the next round
cron.schedule("0 * * * *", async () => {
  const istNow = getISTDate();
  console.log(`\n[CRON 00] Triggered at IST: ${istNow.toISOString()}`);

  try {
    const combo = getNextRoundId();
    logCombo("Next Round", combo);

    const exists = await roundsModel.findOne({ combo });

    if (!exists) {
      const lastRound = await roundsModel.findOne().sort({ createdAt: -1 }).limit(1).lean();
      const nextRoundId = lastRound?.roundId ? lastRound.roundId + 1 : 1;

      await roundsModel.create({
        date: getISTDateOnly(combo),
        time: combo,
        combo,
        roundId: nextRoundId,
        isClosed: false,
        createdAt: istNow, // Store creation time in IST
        updatedAt: istNow
      });

      console.log(`[CRON 00] Created next round (roundId: ${nextRoundId}).`);
    } else {
      console.log("[CRON 00] Next round already exists.");
    }
  } catch (err) {
    console.error(`[CRON 00] Error: ${err.message}`);
  }
});

// CRON at :59 IST — Process bets and assign winners
cron.schedule("59 * * * *", async () => {
  const istNow = getISTDate();
  console.log(`\n[CRON 59] Triggered at IST: ${istNow.toISOString()}`);

  try {
    const combo = getCurrentRoundId();
    const round = await roundsModel.findOne({ combo, isClosed: true });

    if (!round) {
      console.log(`[CRON 59] No closed round found for: ${combo.toISOString()}`);
      return;
    }

    // Assign winning card if not already set
    if (!round.cardId) {
      const cardBets = await betModel.aggregate([
        { $match: { roundId: round._id } },
        { $group: { _id: "$cardId", totalBets: { $sum: "$betAmount" } } },
        { $sort: { totalBets: 1 } },
        { $limit: 1 },
      ]);

      if (cardBets.length > 0) {
        round.cardId = cardBets[0]._id;
      } else {
        const [randomCard] = await cardModel.aggregate([{ $sample: { size: 1 } }]);
        if (!randomCard) throw new Error("No card available for assignment.");
        round.cardId = randomCard._id;
      }

      round.resultDeclaredAt = istNow; // Store result declaration time in IST
      round.updatedAt = istNow;
      await round.save();
      console.log(`[CRON 59] Assigned cardId ${round.cardId} to round.`);
    }

    // Process bets
    const bets = await betModel.find({ roundId: round._id });
    const bulkUserOps = [];
    const bulkBetOps = [];

    for (const bet of bets) {
      const isWin = bet.cardId.toString() === round.cardId.toString();
      const resultAmount = isWin ? bet.betAmount * 11 : bet.betAmount;
      const userCredit = isWin ? resultAmount : 0;

      bulkBetOps.push({
        updateOne: {
          filter: { _id: bet._id },
          update: { 
            $set: { 
              status: isWin ? "win" : "loss", 
              resultAmount,
              processedAt: istNow, // Store processing time in IST
              updatedAt: istNow
            } 
          },
        },
      });

      if (userCredit > 0) {
        bulkUserOps.push({
          updateOne: {
            filter: { _id: bet.userId },
            update: { 
              $inc: { balance: userCredit },
              $set: { updatedAt: istNow } // Update user record time in IST
            },
          },
        });
      }
    }

    if (bulkUserOps.length) {
      await User.bulkWrite(bulkUserOps);
      console.log(`[CRON 59] Updated balances for ${bulkUserOps.length} users.`);
    }

    if (bulkBetOps.length) {
      await betModel.bulkWrite(bulkBetOps);
      console.log(`[CRON 59] Updated bet statuses for ${bulkBetOps.length} bets.`);
    }

    // Mark round as processed
    round.isProcessed = true;
    round.processedAt = istNow;
    round.updatedAt = istNow;
    await round.save();

    console.log(`[CRON 59] Processing complete for round: ${combo.toISOString()}`);
  } catch (err) {
    console.error(`[CRON 59] Error: ${err.message}`);
  }
});

// Optional: Add a health check cron to monitor the system
cron.schedule("*/15 * * * *", async () => {
  try {
    const istNow = getISTDate();
    console.log(`[HEALTH CHECK] System running - IST: ${istNow.toISOString()}`);
    
    // Check if there's an active round
    const activeRound = await roundsModel.findOne({ isClosed: false }).sort({ createdAt: -1 });
    if (activeRound) {
      console.log(`[HEALTH CHECK] Active round found: ${activeRound.roundId}, Combo: ${activeRound.combo.toISOString()}`);
    } else {
      console.log(`[HEALTH CHECK] No active round found`);
    }

    // Check for any rounds that should be closed but aren't
    const istCurrentHour = getCurrentRoundId();
    const shouldBeClosedRound = await roundsModel.findOne({ 
      combo: { $lt: istCurrentHour }, 
      isClosed: false 
    });
    
    if (shouldBeClosedRound) {
      console.log(`[HEALTH CHECK] WARNING: Found unclosed round that should be closed: ${shouldBeClosedRound.roundId}`);
    }
  } catch (err) {
    console.error(`[HEALTH CHECK] Error: ${err.message}`);
  }
});

// Export helper functions for use in other files
module.exports = {
  getISTDate,
  getCurrentRoundId,
  getNextRoundId,
  getPreviousRoundId,
  getISTDateOnly
};