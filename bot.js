// Load environment variables from .env file
require('dotenv').config();

// Import necessary classes from discord.js
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    REST, 
    Routes, 
    ApplicationCommandOptionType,
    ActivityType // Import ActivityType for setting custom presence
} = require('discord.js');

// --- BOT CONFIGURATION AND CLIENT INITIALIZATION ---

// We need these Intents for the bot to see messages and other events
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,           // Guild (server) data
        GatewayIntentBits.GuildMessages,    // Read/receive messages
        GatewayIntentBits.MessageContent,   // REQUIRED to read message content (for link detection)
    ],
});

// --- PERSISTENT DATA STORAGE (In-memory for this example) ---
/**
 * Stores channel IDs where links are blocked, and their custom warning message.
 * Key: Channel ID (string)
 * Value: Custom warning message (string)
 */
const linkBlockedChannels = {};

// --- UTILITY FUNCTION FOR LINK DETECTION ---

/**
 * A simple regex to detect common links (http, https, www, or discord invites).
 * @param {string} text 
 * @returns {boolean} True if a link is found.
 */
const containsLink = (text) => {
    // Regex matches http:// or https:// or www. or discord.gg or a simple .com/.net etc.
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+|\.[a-z]{2,4}\/)/i;
    return urlRegex.test(text);
};


// --- SLASH COMMAND DEFINITION ---

const commands = [
    {
        name: 'linkblock',
        description: 'Blocks all links in the current channel and sets a custom warning message.',
        // Require Administrator permission (bitfield '8') to see and use the command
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
        // Require Administrator permission (bitfield '8') to see and use the command
        default_member_permissions: '8',
        options: [
            {
                name: 'channel',
                description: 'The channel to send the broadcast to.',
                type: ApplicationCommandOptionType.Channel,
                required: true,
            },
            {
                name: 'message',
                description: 'The content of the announcement.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
];

// --- COMMAND REGISTRATION FUNCTION ---

/**
 * Registers the slash commands with Discord's API.
 * This is done on bot ready. Using GUILD_ID for instant registration/testing.
 */
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');

        // Registers commands for a specific guild (server)
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands for the guild.');
    } catch (error) {
        console.error('Failed to register commands:', error);
    }
}


// --- 1. READY EVENT HANDLER ---

client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    // Register commands when the bot is ready
    registerCommands();
    
    // --- UPDATED: SET PRESENCE TO DO NOT DISTURB (DND) ---
    client.user.setPresence({
        activities: [{ name: 'for rule breakers!🛠️', type: ActivityType.Watching }], // Set the activity message (e.g., Watching...)
        status: 'dnd', // Set the status to 'dnd' for red (Do Not Disturb)
    });
});


// --- 2. INTERACTION (SLASH COMMAND) HANDLER ---

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    // Runtime check: Ensure the user has the Administrator permission.
    // This is a safety measure, though visibility is restricted by default_member_permissions.
    if (!interaction.memberPermissions.has('Administrator')) {
        return interaction.reply({ 
            content: '🚫 You must have Administrator permissions to use this command.', 
            ephemeral: true 
        });
    }

    const { commandName } = interaction;

    // --- /linkblock COMMAND LOGIC ---
    if (commandName === 'linkblock') {
        const reason = interaction.options.getString('reason');
        const channelId = interaction.channelId;

        // Store the channel and its custom warning reason
        linkBlockedChannels[channelId] = reason;

        const confirmationEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🔗 Link Blocker Activated')
            .setDescription(`All links are now blocked in this channel: <#${channelId}>.
            
            **Custom Warning Message Set:**
            >>> ${reason}`)
            .setFooter({ text: 'The bot will now automatically delete links posted here.' });
            
        await interaction.reply({ embeds: [confirmationEmbed] });
    }

    // --- /broadcast COMMAND LOGIC ---
    if (commandName === 'broadcast') {
        const targetChannel = interaction.options.getChannel('channel');
        const messageContent = interaction.options.getString('message');

        // Check if the target is a text channel
        if (!targetChannel.isTextBased()) {
            return interaction.reply({ content: '🚫 Please select a valid text channel for the broadcast.', ephemeral: true });
        }

        const modName = interaction.user.tag;

        const broadcastEmbed = new EmbedBuilder()
            .setColor('#3498db') // Blue color
            .setTitle('📣 Broadcast Message (Mods)')
            .setDescription(
                // Making the message content bold for maximum visibility
                `**${messageContent}**`
            )
            // Removed addFields to focus on the message content
            .setTimestamp() // Displays time and date
            .setFooter({ text: `Announcement posted by Moderator: ${modName}` }); 

        try {
            // Send the announcement and ping @everyone (by adding it to the message content)
            await targetChannel.send({ content: '@everyone', embeds: [broadcastEmbed] });
            await interaction.reply({ 
                content: `✅ Broadcast sent successfully to ${targetChannel}!`, 
                ephemeral: true 
            });
        } catch (error) {
            console.error(`Could not send broadcast to ${targetChannel.name}:`, error);
            await interaction.reply({ 
                content: `❌ Could not send broadcast to ${targetChannel}. Check bot permissions.`, 
                ephemeral: true 
            });
        }
    }
});


// --- 3. MESSAGE (LINK DELETION) HANDLER ---

client.on('messageCreate', async (message) => {
    // Ignore bots and DMs
    if (message.author.bot || !message.inGuild()) return;

    const channelId = message.channel.id;
    const customReason = linkBlockedChannels[channelId];

    // Check if the channel is link-blocked AND the message contains a link
    if (customReason && containsLink(message.content)) {
        
        // 1. Delete the link message
        try {
            await message.delete();
        } catch (error) {
            console.error(`Failed to delete message in ${message.channel.name}:`, error);
            // If the bot cannot delete, it can't enforce the rule, so we stop here.
            return;
        }

        // 2. Prepare the warning embed
        const warningEmbed = new EmbedBuilder()
            .setColor('#FF0000') // Red color for warning
            .setTitle('⛔ WARNING: Link Deletion')
            .setDescription(
                // Corrected Grammar and clearer flow
                `**❌ Link Posting Violation ❌**

                **Do not post any type of links, including Discord Invites, in this channel!**
                
                **Action:** Your message was automatically deleted.
                
                **Channel Note:**
                >>> ${customReason}
                
                *Thank you for respecting the server rules.*`
            )
            .setAuthor({ 
                name: message.author.tag, 
                iconURL: message.author.displayAvatarURL() 
            })
            .setTimestamp()
            .setFooter({ text: `This warning will self-delete in 5 seconds.` }); // Updated footer text

        // 3. Send the warning message and auto-delete it
        try {
            const warningMessage = await message.channel.send({ 
                content: `<@${message.author.id}>`, // Ping the user
                embeds: [warningEmbed] 
            });
            
            // Auto-delete the warning message after 5 seconds (5000 milliseconds)
            setTimeout(() => {
                warningMessage.delete().catch(err => {
                    // Log an error if the message couldn't be deleted
                    console.error('Failed to auto-delete warning message:', err);
                });
            }, 5000);

        } catch (error) {
            console.error(`Failed to send warning to user in ${message.channel.name}:`, error);
        }
    }
});

// --- CLIENT LOGIN ---

client.login(process.env.DISCORD_TOKEN);
