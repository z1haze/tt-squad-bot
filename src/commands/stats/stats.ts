import {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    EmbedBuilder,
    AutocompleteInteraction,
    ApplicationCommandOptionChoiceData
} from "discord.js";

import env from '../../util/env';
import {redis} from "../../index";
import {getCaseInsensitiveGlobPattern, nth} from "../../util/helpers";
import {Player, PlayerServer} from "../../typings/player";
import {getSteamAvatarUrl} from "../../lib/stats";

/**
 * Show an individual player's squad stats
 */
export default {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Show stats for a specific player')
        .addStringOption(option =>
            option.setName('target')
                .setDescription('A player\'s name or their Steam ID')
                .setAutocomplete(true)
                .setRequired(true))
        .addStringOption(option =>
            option.setName('visibility')
                .setDescription('If set to to private, response will be sent only to the command sender')
                .addChoices(
                    {name: 'Public', value: 'public'},
                    {name: 'Private', value: 'private'}
                )),

    autocomplete: async (interaction: AutocompleteInteraction) => {
        const focusedValue = interaction.options.getFocused();

        if (focusedValue.length < 3) {
            return interaction.respond([]);
        }

        const suggestions: ApplicationCommandOptionChoiceData[] = await new Promise(resolve => {
            const suggestions: ApplicationCommandOptionChoiceData[] = [];
            const pattern = getCaseInsensitiveGlobPattern(focusedValue);

            const stream = redis.hscanStream("players", {
                match: `*${pattern}*`,
            });

            stream.on('data', (data) => {
                if (data.length) {
                    suggestions.push({name: data[0], value: data[1]});
                }

                if (suggestions.length > 4) {
                    stream.pause();
                    resolve(suggestions);
                    return;
                }
            });

            stream.on('end', () => resolve(suggestions));
        });

        try {
            await interaction.respond(suggestions);
        } catch (error: any) {
            console.error(error.message);
            console.log(JSON.stringify(suggestions));
        }
    },

    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply({
            ephemeral: interaction.options.getString('visibility') === 'private'
        });

        let target = interaction.options.getString('target')!;

        const targetResult = await redis.hget('stats', target);

        if (!targetResult) {
            return interaction.followUp({
                ephemeral: true,
                content: `No player found matching ${target}.`
            });
        }

        const player: Player = JSON.parse(targetResult);

        const embed = new EmbedBuilder()
            .setColor('Blurple')
            .setTitle(`${player.name}'s stats`)
            .setURL(`https://steamcommunity.com/profiles/${target}`);

        const overallRank = (await redis.zrevrank('leaderboard:rating', player.steamId) as number) + 1;
        const killsRank = (await redis.zrevrank('leaderboard:kills', player.steamId) as number) + 1;
        const revivesRank = (await redis.zrevrank('leaderboard:revives', player.steamId) as number) + 1;

        let description = `${player.name} is ranked **${overallRank.toLocaleString('en-US')}${nth(overallRank)}** overall.`;

        description += `\nThey are ranked **${killsRank.toLocaleString('en-US')}${nth(killsRank)}** in kills and **${revivesRank.toLocaleString('en-US')}${nth(revivesRank)}** in revives.`;

        embed.setDescription(description);

        let fieldValue = `${env.EMOJI_KILL} **KILLS:** ${player.servers.reduce((acc: number, curr: PlayerServer) => acc + curr.kills, 0)}\n`;
        fieldValue += `${env.EMOJI_DOWN} **DOWNS:** ${player.servers.reduce((acc: number, curr: PlayerServer) => acc + curr.downs, 0)}\n`;
        fieldValue += `${env.EMOJI_DEATH} **DEATHS:** ${player.servers.reduce((acc: number, curr: PlayerServer) => acc + curr.deaths, 0)}\n`;
        fieldValue += `${env.EMOJI_KD} **K/D:** ${(player.servers.reduce((acc: number, curr: PlayerServer) => acc + curr.kdr, 0) / player.servers.length).toFixed(1)}\n`;
        fieldValue += `${env.EMOJI_REVIVE} **REVIVES:** ${player.servers.reduce((acc: number, curr: PlayerServer) => acc + curr.revives, 0)}\n`;
        fieldValue += `${env.EMOJI_TK} **TKS:** ${player.servers.reduce((acc: number, curr: PlayerServer) => acc + curr.tks, 0)}`;

        embed.addFields({name: 'Stats', value: fieldValue});

        const steamAvatarUrl = await getSteamAvatarUrl(player.steamId);

        if (steamAvatarUrl) {
            embed.setThumbnail(steamAvatarUrl);
        }

        const lastUpdate = await redis.get('lastUpdate')!;

        if (lastUpdate) {
            embed.setFooter({text: 'Last updated'});
            embed.setTimestamp(parseInt(lastUpdate));
        }

        return interaction.followUp({
            embeds: [embed]
        });
    }
};