import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { basicAuth } from 'hono/basic-auth';
import { prettyJSON } from 'hono/pretty-json';
import z from 'zod';
import { studio } from '@outerbase/browsable-durable-object';

export { PoolManager } from './durable/pool-manager';
export { PoolContainer } from './durable/pool-container';

const app = new OpenAPIHono<{ Bindings: Env }>({
	strict: true,
	defaultHook: (result, c) => {
		if (!result.success) {
			console.log(result.error.errors);
			return c.json(
				{
					ok: false,
					errors: result.error.errors,
				},
				422
			);
		}
	},
});

app.use(prettyJSON());

app.notFound((c) => {
	return c.json(
		{
			ok: false,
			errors: ['Not Found'],
		},
		404
	);
});

app.doc31('/openapi', {
	openapi: '3.1.0',
	info: {
		version: '1.0.0',
		title: 'Container Manager',
	},
});

app.openapi(
	createRoute({
		method: 'post',
		path: '/container',
		request: {
			body: {
				required: false,
				content: {
					'application/json': {
						schema: z.object({
							location: z.enum(['wnam', 'enam', 'sam', 'weur', 'eeur', 'apac', 'oc', 'afr', 'me']).optional(),
							maxLifetimeInSeconds: z.number().int().min(1).max(3600).optional(),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				description: 'Test started',
				content: {
					'application/json': {
						schema: z.object({
							id: z.string(),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const { location, maxLifetimeInSeconds } = c.req.valid('json');

		const id = c.env.POOL_MANAGER.idFromName(location ?? 'default');
		const stub = c.env.POOL_MANAGER.get(id, { locationHint: location });
		const instance = await stub.getInstance({ location, maxLifetimeInSeconds });

		return c.json({
			id: instance,
		});
	}
);

app.all('/studio', (c) => {
	return studio(c.req.raw, c.env.POOL_MANAGER, {});
});

app.all('/container/:id', (c) => {
	const containerId = c.req.param('id');

	const id = c.env.POOL_CONTAINER.idFromString(containerId);
	const container = c.env.POOL_CONTAINER.get(id);
	return container.fetch(c.req.raw);
});

export default {
	fetch(request, env) {
		return app.fetch(request, env);
	},
} satisfies ExportedHandler<Env>;
