import { InteractionReplyOptions, MessageActionRow, MessageEmbed, MessagePayload, MessageSelectMenu } from "discord.js";
import { Game, IDStrings, Playtypes, PublicUserDocument, UGSRatingsLookup } from "tachi-common";
import { PBScoreDocument } from "tachi-common/js/types";
import { LoggerLayers } from "../config";
import { validSelectCustomIdPrefaces } from "../interactionHandlers/selectMenu/handleIsSelectMenu";
import { TachiServerV1Get } from "../utils/fetch-tachi";
import { createLayeredLogger } from "../utils/logger";
import { formatGameScoreRating, getGameImage } from "../utils/utils";
import { getDetailedSongData, SongSearchResult } from "./chartSearch";

const logger = createLayeredLogger(LoggerLayers.buildChartEmbed);

export interface PBResponse {
	users: PublicUserDocument[];
	pbs: PBScoreDocument[];
}

export const buildSongSelect = <T extends Game>(songs: SongSearchResult[], playtype: Playtypes[T], game: Game) => {
	return new MessageActionRow().addComponents(
		new MessageSelectMenu()
			.setCustomId(validSelectCustomIdPrefaces.selectSongForSearch)
			.setPlaceholder("Select Song")
			.addOptions(
				songs.map((chart) => {
					return {
						label: `${chart.title} - ${chart.artist}`,
						value: `${chart.id}:${playtype}:${game}`
					};
				})
			)
	);
};

interface SimplePBDocument
	extends Pick<PBScoreDocument, "scoreData">,
		Pick<PBScoreDocument, "calculatedData">,
		Partial<PublicUserDocument> {}

export const getPBForChart = async <T extends Game>(
	chartId: string,
	playtype: Playtypes[T],
	game: Game
): Promise<SimplePBDocument> => {
	try {
		const data = await TachiServerV1Get<PBResponse>(`/games/${game}/${playtype}/charts/${chartId}/pbs`);
		if (data.success) {
			const pbs = data.body.pbs;
			const users = data.body.users;

			const topPb = pbs[0];
			const topUser = users.find((user) => user.id === topPb.userID);

			return {
				...topUser,
				scoreData: topPb.scoreData,
				calculatedData: topPb.calculatedData
			};
		} else {
			logger.error(data.description);
			throw new Error(data.description);
		}
	} catch (e) {
		logger.error(e);

		throw new Error("Unable to fetch PBs for chart");
	}
};

export const buildChartEmbed = async <T extends Game, I extends IDStrings = IDStrings>(args: {
	searchResults?: SongSearchResult[];
	songId?: string;
	playtype: Playtypes[T];
	game: Game;
}): Promise<InteractionReplyOptions | MessagePayload> => {
	try {
		const { searchResults, songId, playtype, game } = args;

		const embed = new MessageEmbed().setColor("#cc527a");

		if (!songId && searchResults) {
			embed.addField(`${searchResults.length} potential results found`, "Select from the dropdown");
			return { embeds: [embed], components: [buildSongSelect(searchResults, playtype, game)] };
		} else if (songId) {
			const details = await getDetailedSongData(songId, playtype, game);
			embed.addField(details.song.title || "Song", details.song.artist || "Artist");
			embed.setThumbnail(getGameImage(details.song.firstVersion || "0", game));

			const sortedCharts = details.charts.sort((a, b) => a.levelNum - b.levelNum);

			for (const chart of sortedCharts) {
				try {
					const PB = await getPBForChart(chart.chartID, chart.playtype, game);
					embed.addField(
						`${chart.difficulty} (${chart.level})`,
						`Server Top: **[${PB.username}](https://kamaitachi.xyz/dashboard/profiles/${
							PB.id
						}/games/${game}?playtype=${playtype})**\n${PB.scoreData.percent.toFixed(2)}% [${
							PB.scoreData.score
						}]\n${PB.scoreData.grade} [${PB.scoreData.lamp}]\n${Object.keys(PB.calculatedData)
							.map((item) => {
								return `${item}: ${formatGameScoreRating(
									{ game, playtype },
									<UGSRatingsLookup[I]>item,
									PB.calculatedData[item as never] || 0
								)}`;
							})
							.join("\n")}`,
						false
					);
				} catch {
					embed.addField(`${chart.difficulty} (${chart.level})`, "No Scores Available!");
				}
			}

			return { embeds: [embed] };
		} else {
			throw new Error("Invalid call to buildChartEmbed");
		}
	} catch (e) {
		logger.error(e);

		throw new Error("Error building chart embed");
	}
};
