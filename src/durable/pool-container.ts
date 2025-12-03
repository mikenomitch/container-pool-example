import { Container, ContainerOptions, StopParams } from '@cloudflare/containers';

export class PoolContainer extends Container<Env> {
	defaultPort = 8080;
	sleepAfter = '30s';

	constructor(ctx: DurableObjectState, env: Env, options?: ContainerOptions) {
		super(ctx, env, options);
	}

	async init(managerId: string): Promise<void> {
		this.ctx.storage.put('manager', managerId);
		await super.startAndWaitForPorts(this.defaultPort);
		await this.keepAlive(true);
	}

	async setMaxLifetime(durationInSeconds: number) {
		this.deleteSchedules('destroy');
		await this.schedule(durationInSeconds, 'destroy');
	}

	async clearKeepAlive() {
		this.deleteSchedules('keepAlive');
	}

	private async keepAlive(init?: boolean) {
		this.renewActivityTimeout();
		const manager = await this.getPoolManager();

		if (!init) {
			await manager.reportRunning(this.ctx.id.toString());
		}

		if (this.ctx.container?.running) {
			await this.schedule(30, 'keepAlive');
		}
	}

	override async destroy() {
		this.deleteSchedules('keepAlive');
		await super.destroy();
	}

	override async onStart() {
		console.log('Container started', this.ctx.id.toString());
	}

	override async onStop(stopParams: StopParams) {
		console.log('Container shut down', stopParams, this.ctx.id.toString());
		try {
			const manager = await this.getPoolManager();
			await manager.reportStopped(this.ctx.id.toString());
		} finally {
			// ensure deleted
			await this.destroy();
		}
	}

	override async onError(error: unknown) {
		console.log('Container error:', error, this.ctx.id.toString());
		try {
			const manager = await this.getPoolManager();
			await manager.reportStopped(this.ctx.id.toString());
		} finally {
			// ensure deleted
			await this.destroy();
		}
	}

	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.startsWith('/admin')) {
			return new Response('Forbidden', { status: 403 });
		}

		if (!this.ctx.container?.running) {
			return new Response('Container is not running', { status: 503 });
		}

		return super.containerFetch(request, this.defaultPort);
	}

	override async containerFetch(
		_requestOrUrl: Request | string | URL,
		_portOrInit?: number | RequestInit,
		_portParam?: number
	): Promise<never> {
		throw new Error('use fetch instead of containerFetch');
	}

	async setup(data: string) {
		super.containerFetch(
			new Request('https://example.com/admin/update-text', {
				method: 'POST',
				body: data,
				headers: { 'Content-Type': 'text/plain' },
			}),
			this.defaultPort
		);
	}

	private async getPoolManager() {
		const managerId = await this.ctx.storage.get<string>('manager');
		if (!managerId) {
			await this.destroy();
			throw new Error('No manager');
		}

		const id = this.env.POOL_MANAGER.idFromString(managerId);
		return this.env.POOL_MANAGER.get(id);
	}
}
