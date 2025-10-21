// --- 0. EXPRESS PING SERVER (Keeps Render Awake) ---
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Ichigo is online!'));
app.listen(PORT, () => console.log(`Ping server running on port ${PORT}`));

// --- 1. LOAD ENVIRONMENT VARIABLES ---
require('dotenv').config();

// --- 2. IMPORT DISCORD.JS ---
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    REST, 
    Routes, 
    ApplicationCommandOptionType,
    ActivityType
} = require('discord.js');

// --- 3. BOT CONFIGURATION AND CLIENT INITIALIZATION ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// --- 4. LINK BLOCKER STORAGE ---
const linkBlockedChannels = {};

// --- 5. LINK DETECTION FUNCTION ---
const containsLink = (text) => {
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+|\.[a-z]{2,4}\/)/i;
    return urlRegex.test(text);
};

// --- 6. SLASH COMMANDS ---
const commands = [
    {
        name: 'linkblock',
        description: 'Blocks all links in the current channel and sets a custom warning message.',
        default_member_permissions: '8', 
        options: [
            {
                name: 'reason',
                description: 'The custom warning message to show users who post a link.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    {
        name: 'broadcast',
        description: 'Sends an official-looking announcement embed to a specified channel.',
        default_member_permissions: '8',
        options: [
            { name: 'channel', description: 'The channel to send the broadcast to.', type: ApplicationCommandOptionType.Channel, required: true },
            { name: 'message', description: 'The content of the announcement.', type: ApplicationCommandOptionType.String, required: true },
        ],
    },
];

// --- 7. REGISTER COMMANDS ---
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands for the guild.');
    } catch (error) {
        console.error('Failed to register commands:', error);
    }
}

// --- 8. READY EVENT ---
client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    registerCommands();
    client.user.setPresence({
        activities: [{ name: 'for rule breakers!🛠️', type: ActivityType.Watching }],
        status: 'dnd',
    });
});

// --- 9. INTERACTION HANDLER ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    if (!interaction.memberPermissions.has('Administrator')) {
        return interaction.reply({ content: '🚫 You must have Administrator permissions to use this command.', ephemeral: true });
    }
    const { commandName } = interaction;

    if (commandName === 'linkblock') {
        const reason = interaction.options.getString('reason');
        const channelId = interaction.channelId;
        linkBlockedChannels[channelId] = reason;

        const confirmationEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🔗 Link Blocker Activated')
            .setDescription(`All links are now blocked in this channel: <#${channelId}>.\n\n**Custom Warning Message Set:**\n>>> ${reason}`)
            .setFooter({ text: 'The bot will now automatically delete links posted here.' });

        await interaction.reply({ embeds: [confirmationEmbed] });
    }

    if (commandName === 'broadcast') {
        const targetChannel = interaction.options.getChannel('channel');
        const messageContent = interaction.options.getString('message');
        if (!targetChannel.isTextBased()) return interaction.reply({ content: '🚫 Please select a valid text channel.', ephemeral: true });

        const broadcastEmbed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('📣 Broadcast Message (Mods)')
            .setDescription(`**${messageContent}**`)
            .setTimestamp()
            .setFooter({ text: `Announcement posted by Moderator: ${interaction.user.tag}` });

        try {
            await targetChannel.send({ content: '@everyone', embeds: [broadcastEmbed] });
            await interaction.reply({ content: `✅ Broadcast sent successfully to ${targetChannel}!`, ephemeral: true });
        } catch (error) {
            console.error(`Could not send broadcast:`, error);
            await interaction.reply({ content: `❌ Could not send broadcast. Check bot permissions.`, ephemeral: true });
        }
    }
});

// --- 10. MESSAGE HANDLER (LINK DELETION) ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.inGuild()) return;
    const channelId = message.channel.id;
    const customReason = linkBlockedChannels[channelId];

    if (customReason && containsLink(message.content)) {
        try { await message.delete(); } catch (err) { return; }

        const warningEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('⛔ WARNING: Link Deletion')
            .setDescription(`**❌ Link Posting Violation ❌**\n\n**Do not post links in this channel!**\n**Action:** Deleted.\n**Channel Note:**\n>>> ${customReason}\n*Thank you for respecting the server rules.*`)
            .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
            .setTimestamp()
            .setFooter({ text: `This warning will self-delete in 5 seconds.` });

        try {
            const warningMessage = await message.channel.send({ content: `<@${message.author.id}>`, embeds: [warningEmbed] });
            setTimeout(() => warningMessage.delete().catch(err => console.error(err)), 5000);
        } catch (error) {
            console.error(`Failed to send warning:`, error);
        }
    }
});

// --- 11. CLIENT LOGIN ---
client.login(process.env.DISCORD_TOKEN);
