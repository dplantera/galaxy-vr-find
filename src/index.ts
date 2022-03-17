import sqlite3 from 'sqlite3'
import {open} from 'sqlite'
import * as fs from "fs";
import axios from "axios";
import * as cheerio from 'cheerio';
import {compareTwoStrings} from 'string-similarity';

const PATH_FILE_DB_GOG = "C:\\ProgramData\\GOG.com\\Galaxy\\storage\\galaxy-2.0.db";
const PATH_OUT_ROOT = './out';

async function main() {
    if (!fs.existsSync(PATH_OUT_ROOT)) {
        fs.mkdirSync(PATH_OUT_ROOT);
    }

    const result = await readTitlesFromGogDb();

    fs.writeFileSync(PATH_OUT_ROOT + "/db.json", JSON.stringify(result ?? ""));
    const titles = result.map(res => res.title).filter((res): res is string => typeof res === 'string');

    const vrGames = await getOrCrawlVrGames();
    fs.writeFileSync(PATH_OUT_ROOT + "/vrGames.json", JSON.stringify(vrGames ?? ""));

    const wmrGames = vrGames.filter((vr: VrGame) => vr.wmr === 'Native support').map((wmr: VrGame) => wmr.title);
    const myWmrGames = titles.map(title => ({
        title,
        wmr: wmrGames.filter((wmr: string) => compareTwoStrings(title, wmr) > 0.9)
    }))
        .filter(wmr => wmr.wmr.length > 0);
    fs.writeFileSync(PATH_OUT_ROOT + "/myWmrGames.json", JSON.stringify(myWmrGames));

    const wmrByPlatform = myWmrGames.reduce((prv, curr) => {
        const platform = result.find(res => res.title === curr.title)?.name ?? "unknown";
        if (!prv[platform])
            prv[platform] = [];
        prv[platform].push(curr.title);
        return prv;
    }, {} as any);

    console.log(`\nFound '${myWmrGames.length}' VR games in your GOG galaxy DB: ${PATH_FILE_DB_GOG}`);
    Object.keys(wmrByPlatform).forEach(key => {
        console.log(`
- ${key}: 
   - ${wmrByPlatform[key].join("\n   - ")}`)
    })
}

type VrGame = { title: string, url: string, wmr: string };

async function readTitlesFromGogDb() {
    const db = await open({
        filename: PATH_FILE_DB_GOG,
        driver: sqlite3.Database
    })
    const result: { name: string, title: string | null }[] = await db.all(
        `SELECT DISTINCT b.name, json_extract(value, '$.title') as title
         FROM ProductPurchaseDates
                  JOIN GamePieces
                       ON ProductPurchaseDates.gameReleaseKey = GamePieces.releaseKey
                  join platforms b on releaseKey like b.name || '%'`);
    if (result?.length <= 0) {
        throw Error(`make sure file exists by use gog galaxy integrations - could not read: ${PATH_FILE_DB_GOG} `)
    }
    return result;
}

async function getOrCrawlVrGames() {
    if (fs.existsSync(PATH_OUT_ROOT + "/vrGames.json"))
        return JSON.parse(fs.readFileSync(PATH_OUT_ROOT + "/vrGames.json").toString());

    const vrGames: VrGame[] = [];
    try {
        await doCrawl(500, 0, vrGames);
    } catch (error) {
        console.error(error);
    }
    return vrGames;
}

async function doCrawl(limit: number, offset: number, vrGames: VrGame[]) {
    while (offset < 5000) {
        console.log(`crawling with offset: ${offset}...`)
        await wait(1500)
        const response = await getData(limit, offset);
        const $ = cheerio.load(response.data);
        const rows = $("table > tbody > tr");
        if (!rows) {
            break;
        }
        const mapped = Object.values(rows).map((row: any) => {
            const cells = $('td', row);
            const first = $("a", cells[0]).attr();
            const _wmr = $("div", cells[5]).attr();
            const [title, url, wmr] = [first?.title, first?.href, _wmr?.title];
            return {title, url, wmr}
        }).filter(r => r.title);
        console.log(`done crawling: crawled ${mapped.length}`)
        vrGames.push(...mapped);
        offset += limit;
    }
}

function wait(ms: number) {
    return new Promise((resolve => {
        setTimeout(resolve, ms);
    }));
}

async function getData(limit: number, offset: number) {
    return axios.get(`https://www.pcgamingwiki.com/w/index.php?title=Special:CargoQuery&limit=${limit}&offset=${offset}&tables=VR_support%2CInfobox_game%2CInput&fields=VR_support._pageName%2CInfobox_game.Available_on%2CVR_support.HTC_Vive%2CVR_support.Oculus_Rift%2CVR_support.OSVR%2CVR_support.Windows_Mixed_Reality%2CInput.Tracked_motion_controllers%2CInput.Controller_support_level%2CVR_support.Keyboard_mouse%2CVR_support.Play_area_seated%2CVR_support.Play_area_standing%2CVR_support.Play_area_room_scale%2CVR_support.VR_only&where=VR_support.VR_only+IS+NOT+NULL&join_on=Infobox_game._pageName%3DVR_support._pageName%2CInfobox_game._pageName%3DInput._pageName&format=template&named+args=yes&intro=%3Ctable+class%3D%22wikitable+sortable%22+style%3D%22width%3A+100%25%3Btext-align%3A+center%22%3E%0A%09%3Ctr%3E%0A%09%09%3Cth+rowspan%3D%222%22+style%3D%2222%25%3B%22%3EGame%3C%2Fth%3E%0A%09%09%3Cth+rowspan%3D%222%22+style%3D%22width%3A+8%25%3B%22%3ESystems%3C%2Fth%3E%0A%09%09%3Cth+colspan%3D%224%22%3EHeadsets%3C%2Fth%3E%0A%09%09%3Cth+colspan%3D%223%22%3EControllers%3C%2Fth%3E%0A%09%09%3Cth+colspan%3D%223%22%3EPlay+Area%3C%2Fth%3E%0A%09%09%3Cth+rowspan%3D%222%22+style%3D%22width%3A+6%25%3B%22%3E%3Cabbr+title%3D%22This+game+requires+a+virtual+reality+headset%22%3EVR+only%3C%2Fabbr%3E%3C%2Fth%3E%0A%09%3C%2Ftr%3E%0A%09%3Ctr%3E%0A%09%09%3Cth+style%3D%22width%3A+7%25%3B%22%3EHTC+Vive%3C%2Fth%3E%0A%09%09%3Cth+style%3D%22width%3A+7%25%3B%22%3EOculus+Rift%3C%2Fth%3E%0A%09%09%3Cth+style%3D%22width%3A+7%25%3B%22%3E%3Cabbr+title%3D%22Open+Source+Virtual+Reality%22%3EOSVR%3C%2Fabbr%3E%3C%2Fth%3E%0A%09%09%3Cth+style%3D%22width%3A+7%25%3B%22%3EWindows+Mixed+Reality%3C%2Fth%3E%0A%09%09%3Cth+style%3D%22width%3A+6%25%3B%22%3E%3Cabbr+title%3D%22Tracked+motion+controllers%22%3EMotion%3C%2Fabbr%3E%3C%2Fth%3E%0A%09%09%3Cth+style%3D%22width%3A+6%25%3B%22%3E%3Cdiv+title%3D%22Traditional+controller%22+style%3D%22width%3A+30px%3B+height%3A+22px%3B%22+class%3D%22svg-icon+tickcross-controller-full%22%3E%3C%2Fdiv%3E%3C%2Fth%3E%0A%09%09%3Cth+style%3D%22width%3A+6%25%3B%22%3E%3Cabbr+title%3D%22Keyboard%2FMouse%22%3EKB%2FM%3C%2Fabbr%3E%3C%2Fth%3E%0A%09%09%3Cth+style%3D%22width%3A+6%25%3B%22%3ESeated%3C%2Fth%3E%0A%09%09%3Cth+style%3D%22width%3A+6%25%3B%22%3EStanding%3C%2Fth%3E%0A%09%09%3Cth+style%3D%22width%3A+6%25%3B%22%3ERoom-Scale%3C%2Fth%3E%0A%09%3C%2Ftr%3E&template=VR%2Frow&outro=%3C%2Ftable%3E`);
}

main().then(() => console.log("\nshutting down")).catch(err => console.error(err))
