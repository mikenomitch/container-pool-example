CREATE TABLE `containers` (
	`id` text PRIMARY KEY NOT NULL,
	`status` integer DEFAULT 0 NOT NULL,
	`startedAt` integer NOT NULL,
	`releasedAt` integer
);
