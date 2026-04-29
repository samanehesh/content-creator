import { extractMarkdownLinks, countWords, generateArticleFromTopic } from './contentService';

async function main() {
  const article = await generateArticleFromTopic(
    'How to improve TEF speaking fluency under time pressure',
    'TEF speaking tips',
  );

  const links = extractMarkdownLinks(article.articleMarkdown);
  console.log(
    JSON.stringify(
      {
        articleTitle: article.articleTitle,
        bodyWordCount: countWords(article.articleMarkdown),
        mockoLinks: links.filter(link => link.startsWith('https://mocko.ai')),
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
