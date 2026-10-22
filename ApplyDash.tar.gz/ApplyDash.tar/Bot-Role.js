const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./Config/Config.json');
const Submission = require('./Database/Submission');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    setInterval(checkSubmissions, 5 * 60 * 1000);
});

async function checkSubmissions() {
    try {
        const submissions = await Submission.find({ status: { $in: ['approved', 'rejected'] } });

        for (const submission of submissions) {
            const guild = client.guilds.cache.first();
            const member = await guild.members.fetch(submission.userId);

            if (submission.status === 'approved') {
                if (config.AcceptRole && config.AcceptRole.length > 0) {
                    for (const roleId of config.AcceptRole) {
                        const role = guild.roles.cache.get(roleId);
                        if (role) {
                            await member.roles.add(role);
                            console.log(`Added role ${role.name} to user ${member.user.tag}`);
                        } else {
                            console.error(`Role with ID ${roleId} not found in the server`);
                        }
                    }
                } else {
                    console.error('No AcceptRole defined in the configuration');
                }
            }
            await Submission.findByIdAndDelete(submission._id);
            console.log(`Removed submission for user ${member.user.tag}`);
        }
    } catch (error) {
        console.error('Error checking submissions:', error);
    }
}

client.login(config.BotToken);
