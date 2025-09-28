import { Browser, Page, DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import UserAgent from "user-agents";
import { IGpassword, IGusername } from "../secret";
import logger from "../config/logger";
import { Instagram_cookiesExist, loadCookies, saveCookies } from "../utils";
import { runAgent } from "../Agent";
import { getInstagramCommentSchema } from "../Agent/schema";

// Add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());
puppeteer.use(
    AdblockerPlugin({
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runInstagram() {
    const browser = await puppeteer.launch({
        headless: false,
    });

    const page = await browser.newPage();
    const userAgent = new UserAgent();
    await page.setUserAgent(userAgent.toString());

    const cookiesPath = "./cookies/Instagramcookies.json";

    try {
        const cookiesExist = await Instagram_cookiesExist();
        logger.info(`Checking cookies existence: ${cookiesExist}`);

        if (cookiesExist) {
            const cookies = await loadCookies(cookiesPath);
            await page.setCookie(...cookies);
            logger.info('Cookies loaded and set on the page.');
        }

        await page.goto("https://www.instagram.com/", { waitUntil: 'networkidle2' });

        const isLoggedIn = await page.$("a[href='/direct/inbox/']");
        if (!isLoggedIn) {
            logger.warn("Not logged in. Proceeding with login...");
            await loginWithCredentials(page);
        } else {
            logger.info("Already logged in.");
        }

        const cookies = await page.cookies();
        await saveCookies(cookiesPath, cookies);

        await page.screenshot({ path: "logged_in.png" });

        await interactWithPosts(page);
    } catch (error) {
        logger.error("An error occurred during the Instagram automation process:", error);
    } finally {
        await browser.close();
    }
}

const loginWithCredentials = async (page: Page) => {
    try {
        await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: 'networkidle2' });
        await page.waitForSelector('input[name="username"]', { timeout: 5000 });

        await page.type('input[name="username"]', IGusername);
        await page.type('input[name="password"]', IGpassword);
        await page.click('button[type="submit"]');

        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        logger.info("Successfully logged in.");
    } catch (error) {
        logger.error("Error logging in with credentials:", error);
        throw error;
    }
}

async function interactWithPosts(page: Page) {
    let postIndex = 1;
    const maxPosts = 50;

    while (postIndex <= maxPosts) {
        try {
            const postSelector = `article:nth-of-type(${postIndex})`;
            const postElement = await page.$(postSelector);

            if (!postElement) {
                logger.info("No more posts found. Exiting loop...");
                break;
            }

            const likeButtonSelector = 'svg[aria-label="Like"]';
            const likeButton = await postElement.$(likeButtonSelector);

            if (likeButton) {
                logger.info(`Liking post ${postIndex}...`);
                await likeButton.click();
                logger.info(`Post ${postIndex} liked.`);
            } else {
                const unlikeButton = await postElement.$('svg[aria-label="Unlike"]');
                if (unlikeButton) {
                    logger.info(`Post ${postIndex} is already liked.`);
                } else {
                    logger.warn(`Like button not found for post ${postIndex}.`);
                }
            }

            const captionSelector = 'div[data-testid="post-caption"]';
            const captionElement = await postElement.$(captionSelector);
            let caption = "";
            if (captionElement) {
                caption = await captionElement.evaluate((el: HTMLElement) => el.innerText);
                logger.info(`Caption for post ${postIndex}: ${caption}`);
            } else {
                logger.info(`No caption found for post ${postIndex}.`);
            }

            const commentBoxSelector = 'textarea[aria-label="Add a comment…"]';
            const commentBox = await postElement.$(commentBoxSelector);
            if (commentBox) {
                logger.info(`Commenting on post ${postIndex}...`);
                const prompt = `Craft a thoughtful, engaging, and mature reply to the following post: "${caption}". The reply should be relevant, insightful, and add value to the conversation, reflecting empathy and professionalism. It must be under 300 characters and comply with Instagram's Community Standards on spam.`;
                const schema = getInstagramCommentSchema();
                const result = await runAgent(schema, prompt);
                const comment = result[0]?.comment;

                if (comment) {
                    await commentBox.type(comment);
                    const postButtonSelector = 'div[data-testid="post-comment-input-button"]';

                    try {
                        // Wait for the post button to be enabled before clicking
                        await page.waitForSelector(`${postSelector} ${postButtonSelector}:not([aria-disabled="true"])`, { timeout: 5000 });
                        const postButton = await postElement.$(postButtonSelector);

                        if (postButton) {
                            await postButton.click();
                            logger.info(`Comment posted on post ${postIndex}.`);
                            await delay(2000); // Wait for the comment to appear
                        } else {
                            // This case should ideally not be reached if waitForSelector succeeds
                            logger.warn(`Post button not found for post ${postIndex} even after waiting.`);
                        }
                    } catch (e) {
                        logger.error(`Post button for post ${postIndex} was not enabled in time or not found.`);
                    }

                } else {
                    logger.warn(`Could not generate a comment for post ${postIndex}.`);
                }
            } else {
                logger.info("Comment box not found.");
            }

            const waitTime = Math.floor(Math.random() * 5000) + 5000;
            logger.info(`Waiting ${waitTime / 1000} seconds before the next post...`);
            await delay(waitTime);

            await page.evaluate(() => {
                window.scrollBy(0, window.innerHeight);
            });

            postIndex++;
        } catch (error) {
            logger.error(`Error interacting with post ${postIndex}:`, error);
            break;
        }
    }
}



export { runInstagram };

