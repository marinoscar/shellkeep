import { Test, TestingModule } from '@nestjs/testing';
import { SshService, DecryptedServerProfile } from './ssh.service';
import { Client, ClientChannel } from 'ssh2';
import { EventEmitter } from 'events';

jest.mock('ssh2');

describe('SshService', () => {
  let service: SshService;
  let MockClient: jest.MockedClass<typeof Client>;

  const mockProfile: DecryptedServerProfile = {
    hostname: 'example.com',
    port: 22,
    username: 'admin',
    authMethod: 'password',
    password: 'my-password',
  };

  const mockTmuxSessionId = 'sk-abcd1234';

  beforeEach(async () => {
    MockClient = Client as jest.MockedClass<typeof Client>;
    MockClient.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SshService],
    }).compile();

    service = module.get<SshService>(SshService);
  });

  function setupMockClient(options: {
    emitReady?: boolean;
    emitError?: Error;
    shellError?: Error;
  } = {}) {
    const clientInstance = new EventEmitter() as any;
    clientInstance.connect = jest.fn();
    clientInstance.end = jest.fn();

    const mockStream = new EventEmitter() as any;
    mockStream.close = jest.fn();
    mockStream.write = jest.fn();
    mockStream.setWindow = jest.fn();

    // The service uses client.shell() to open an interactive shell with PTY
    clientInstance.shell = jest.fn((_opts: any, cb: (err: Error | null, stream: any) => void) => {
      if (options.shellError) {
        cb(options.shellError, null);
      } else {
        cb(null, mockStream);
      }
    });

    MockClient.mockImplementation(() => clientInstance);

    // Schedule events after connect is called
    if (options.emitReady) {
      const origConnect = clientInstance.connect;
      clientInstance.connect = jest.fn((...args: any[]) => {
        origConnect?.apply(clientInstance, args);
        process.nextTick(() => clientInstance.emit('ready'));
      });
    }

    if (options.emitError) {
      const origConnect = clientInstance.connect;
      clientInstance.connect = jest.fn((...args: any[]) => {
        origConnect?.apply(clientInstance, args);
        process.nextTick(() => clientInstance.emit('error', options.emitError));
      });
    }

    return { clientInstance, mockStream };
  }

  describe('connect with password auth', () => {
    it('should connect with password credentials', async () => {
      const { clientInstance } = setupMockClient({ emitReady: true });

      const connection = await service.connect(
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );

      expect(clientInstance.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'example.com',
          port: 22,
          username: 'admin',
          password: 'my-password',
        }),
      );
      expect(connection).toHaveProperty('client');
      expect(connection).toHaveProperty('stream');
      expect(connection).toHaveProperty('close');
      expect(connection).toHaveProperty('resize');
    });
  });

  describe('connect with key auth', () => {
    it('should connect with private key', async () => {
      const { clientInstance } = setupMockClient({ emitReady: true });

      const keyProfile: DecryptedServerProfile = {
        hostname: 'example.com',
        port: 22,
        username: 'admin',
        authMethod: 'key',
        privateKey: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
      };

      await service.connect(keyProfile, mockTmuxSessionId, 80, 24);

      expect(clientInstance.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          privateKey: keyProfile.privateKey,
        }),
      );
    });

    it('should include passphrase when provided with key', async () => {
      const { clientInstance } = setupMockClient({ emitReady: true });

      const keyProfile: DecryptedServerProfile = {
        hostname: 'example.com',
        port: 22,
        username: 'admin',
        authMethod: 'key',
        privateKey: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
        passphrase: 'my-passphrase',
      };

      await service.connect(keyProfile, mockTmuxSessionId, 80, 24);

      expect(clientInstance.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          privateKey: keyProfile.privateKey,
          passphrase: 'my-passphrase',
        }),
      );
    });
  });

  describe('connect with agent auth', () => {
    it('should not include password or privateKey for agent auth', async () => {
      const { clientInstance } = setupMockClient({ emitReady: true });

      const agentProfile: DecryptedServerProfile = {
        hostname: 'example.com',
        port: 22,
        username: 'admin',
        authMethod: 'agent',
      };

      await service.connect(agentProfile, mockTmuxSessionId, 80, 24);

      const connectCall = clientInstance.connect.mock.calls[0][0];
      expect(connectCall).not.toHaveProperty('password');
      expect(connectCall).not.toHaveProperty('privateKey');
    });
  });

  describe('connection error handling', () => {
    it('should reject on connection error', async () => {
      const connError = new Error('Connection refused');
      setupMockClient({ emitError: connError });

      await expect(
        service.connect(mockProfile, mockTmuxSessionId, 80, 24),
      ).rejects.toThrow('Connection refused');
    });

    it('should reject on shell error', async () => {
      const shellError = new Error('Command failed');
      setupMockClient({ emitReady: true, shellError });

      await expect(
        service.connect(mockProfile, mockTmuxSessionId, 80, 24),
      ).rejects.toThrow('Command failed');
    });
  });

  describe('SshConnection methods', () => {
    it('should have close method that ends client and stream', async () => {
      const { clientInstance, mockStream } = setupMockClient({
        emitReady: true,
      });

      const connection = await service.connect(
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );

      connection.close();

      expect(mockStream.close).toHaveBeenCalled();
      expect(clientInstance.end).toHaveBeenCalled();
    });

    it('should have resize method that calls setWindow', async () => {
      const { mockStream } = setupMockClient({ emitReady: true });

      const connection = await service.connect(
        mockProfile,
        mockTmuxSessionId,
        80,
        24,
      );

      connection.resize(120, 40);

      expect(mockStream.setWindow).toHaveBeenCalledWith(40, 120, 0, 0);
    });
  });
});
