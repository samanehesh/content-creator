ALTER TABLE `contentRuns` ADD `shareToken` varchar(64);--> statement-breakpoint
ALTER TABLE `contentRuns` ADD `sharedAt` timestamp;--> statement-breakpoint
ALTER TABLE `contentRuns` ADD CONSTRAINT `contentRuns_shareToken_unique` UNIQUE(`shareToken`);