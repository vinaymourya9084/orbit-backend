// utils/seeder.js
// Populates MongoDB with sample users, conversations, and messages for development

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/orbit';

const sampleUsers = [
  { username: 'alex_orbit', email: 'alex@orbit.app', password: 'password123', vibe: 'excited' },
  { username: 'sam_wave', email: 'sam@orbit.app', password: 'password123', vibe: 'chill' },
  { username: 'jordan_dev', email: 'jordan@orbit.app', password: 'password123', vibe: 'focused' },
  { username: 'priya_codes', email: 'priya@orbit.app', password: 'password123', vibe: 'busy' },
  { username: 'leo_design', email: 'leo@orbit.app', password: 'password123', vibe: 'chill' },
];

const seed = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await Promise.all([
      User.deleteMany({}),
      Conversation.deleteMany({}),
      Message.deleteMany({}),
    ]);
    console.log('Cleared existing data');

    // Create users
    const users = await User.create(sampleUsers);
    console.log(`Created ${users.length} users`);

    // Create a DM between alex and sam
    const dm = await Conversation.create({
      participants: [users[0]._id, users[1]._id],
      isGroup: false,
    });

    // Create a group chat
    const group = await Conversation.create({
      participants: [users[0]._id, users[1]._id, users[2]._id, users[3]._id],
      isGroup: true,
      groupName: 'Orbit Dev Team 🚀',
      groupAdmin: users[0]._id,
      groupDNA: {
        personality: 'fun',
        totalMessages: 0,
        activityByDay: [2, 5, 8, 7, 9, 4, 1],
        activityByHour: [0,0,0,0,0,0,1,3,5,8,10,9,7,8,9,8,7,5,4,3,2,1,1,0],
      },
    });

    // Sample DM messages
    const dmMessages = [
      { sender: users[0]._id, content: 'Hey Sam! Have you seen the new Orbit features? 🔥', messageType: 'standard' },
      { sender: users[1]._id, content: 'Not yet! What\'s new? ✨', messageType: 'standard' },
      { sender: users[0]._id, content: 'The time capsule feature is insane!', messageType: 'standard' },
    ];

    for (const msg of dmMessages) {
      await Message.create({ ...msg, conversation: dm._id });
    }

    // Sample group messages with emojis (for DNA analytics)
    const groupMessages = [
      { sender: users[0]._id, content: 'Welcome to the Orbit dev team! 🚀🎉', messageType: 'standard' },
      { sender: users[1]._id, content: 'So excited to be here! 😍🔥', messageType: 'standard' },
      { sender: users[2]._id, content: 'Let\'s ship this product fast. Focused mode on 💪', messageType: 'standard', priority: 'urgent' },
      { sender: users[3]._id, content: 'I\'ll handle the backend models 🛠️', messageType: 'standard' },
      { sender: users[0]._id, content: 'Time capsule test incoming! ⏰', messageType: 'standard' },
    ];

    for (const msg of groupMessages) {
      await Message.create({ ...msg, conversation: group._id });
    }

    // Update lastMessage pointers
    const lastDM = await Message.findOne({ conversation: dm._id }).sort({ createdAt: -1 });
    const lastGroup = await Message.findOne({ conversation: group._id }).sort({ createdAt: -1 });
    await Conversation.findByIdAndUpdate(dm._id, { lastMessage: lastDM._id });
    await Conversation.findByIdAndUpdate(group._id, { lastMessage: lastGroup._id });

    console.log('\n✅ Seeding complete!');
    console.log('\n👤 Sample accounts (all password: password123):');
    users.forEach(u => console.log(`   ${u.email} — @${u.username} [${u.vibe}]`));
    console.log('\n');

    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
};

seed();
