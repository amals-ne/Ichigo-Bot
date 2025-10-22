// --- /online connect ---
if (commandName === 'online') {
    const vcChannel = interaction.options.getChannel('connect');
    if (!vcChannel || vcChannel.type !== 2) {
        return interaction.reply({ content: '🚫 Select a valid voice channel.', ephemeral: true });
    }

    try {
        // Connect to VC unmuted and undeafened
        const connection = joinVoiceChannel({
            channelId: vcChannel.id,
            guildId: vcChannel.guild.id,
            adapterCreator: vcChannel.guild.voiceAdapterCreator,
            selfMute: false,   // 🔓 Unmuted
            selfDeaf: false,   // 👂 Undeafened
        });

        // Silent audio stream (prevents auto-disconnect)
        const player = createAudioPlayer();
        const SILENCE_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);
        const resource = createAudioResource(SILENCE_FRAME, { inputType: null });

        player.play(resource);
        connection.subscribe(player);

        // Replay silence every 15 seconds to keep the stream active
        setInterval(() => {
            const res = createAudioResource(SILENCE_FRAME, { inputType: null });
            player.play(res);
        }, 15000);

        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        await interaction.reply({ 
            content: `✅ Connected to **${vcChannel.name}** (unmuted/undeafened) and will stay active forever.`, 
            ephemeral: true 
        });

    } catch (err) {
        console.error('Voice connection failed:', err);
        await interaction.reply({ content: '❌ Failed to connect to VC.', ephemeral: true });
    }
}
