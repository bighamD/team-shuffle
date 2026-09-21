import {
	ArrowLeftIcon,
	CameraIcon,
	CheckCircledIcon,
	Cross2Icon,
	DownloadIcon,
	DragHandleDots2Icon,
	EnterIcon,
	Link2Icon,
	MixerHorizontalIcon,
	PersonIcon,
	PlusIcon,
	ReloadIcon,
	RocketIcon,
	ShuffleIcon,
	TargetIcon,
	TrashIcon,
} from '@radix-ui/react-icons';
import QRCode from 'qrcode';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import {
	FlowStack,
	MobileScroll,
	type FlowControls,
	type FlowScreen,
} from './mobile';

type Member = { id: string; name: string };
type Team = { id: string; name: string; members: Member[] };
type Toast = { id: number; text: string } | null;
type Reveal = { teams: Team[]; token: number } | null;
type AppContextValue = {
	members: Member[];
	groupCount: number;
	teams: Team[];
	shareUrl: string;
	qrCode: string;
	toast: Toast;
	reveal: Reveal;
	startReveal: (teams: Team[], onDone?: () => void) => void;
	endReveal: () => void;
	setGroupCount: (count: number) => void;
	addMember: (name: string) => string | null;
	removeMember: (id: string) => void;
	clearMembers: () => void;
	usePreset: () => void;
	shuffleTeams: (countOverride?: number) => Team[] | null;
	swapMembers: (firstId: string, secondId: string) => void;
	createShareUrl: () => string;
	notify: (text: string) => void;
};

const STORAGE_KEY = 'apex-angler-state-v1';
const defaultMemberNames = ['生蚝🦪'];
const presetNames = [
	'生蚝🦪',
	'鸡哥',
	'老张',
	'常乐',
	'大乐',
	'富贵',
	'老唐',
	'小骚',
	'老范',
];
const AppContext = createContext<AppContextValue | null>(null);

function useApp() {
	const value = useContext(AppContext);
	if (!value) throw new Error('useApp must be used inside AppProvider');
	return value;
}

function makeMembers(names: string[]): Member[] {
	return names.map((name, index) => ({
		id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
		name,
	}));
}

function shuffle<T>(items: T[]): T[] {
	const next = [...items];
	for (let index = next.length - 1; index > 0; index -= 1) {
		const target = Math.floor(Math.random() * (index + 1));
		[next[index], next[target]] = [next[target], next[index]];
	}
	return next;
}

function teamLabel(index: number) {
	return `队伍${index + 1}`;
}

function parseCustomGroupCount(draft: string, fallback: number) {
	const trimmed = draft.trim();
	if (!trimmed) return fallback;
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(99, Math.max(2, Math.round(parsed)));
}

function distribute(members: Member[], count: number): Team[] {
	const teams = Array.from({ length: count }, (_, index) => ({
		id: `team-${index + 1}`,
		name: teamLabel(index),
		members: [] as Member[],
	}));
	shuffle(members).forEach((member, index) =>
		teams[index % count].members.push(member),
	);
	return teams;
}

function encodeShare(teams: Team[]) {
	const payload = JSON.stringify({
		version: 1,
		teams: teams.map((team) => ({
			name: team.name,
			members: team.members.map((member) => member.name),
		})),
	});
	const bytes = new TextEncoder().encode(payload);
	let binary = '';
	bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
	return btoa(binary)
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
}

function decodeShare(value: string): Team[] | null {
	try {
		const padded = value
			.replaceAll('-', '+')
			.replaceAll('_', '/')
			.padEnd(Math.ceil(value.length / 4) * 4, '=');
		const binary = atob(padded);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
			teams?: Array<{ name: string; members: string[] }>;
		};
		if (!Array.isArray(parsed.teams) || parsed.teams.length < 2) return null;
		return parsed.teams.map((team, teamIndex) => ({
			id: `shared-team-${teamIndex}`,
			name: team.name || teamLabel(teamIndex),
			members: team.members.map((name, memberIndex) => ({
				id: `shared-${teamIndex}-${memberIndex}`,
				name,
			})),
		}));
	} catch {
		return null;
	}
}

function readInitialState() {
	const shared = window.location.hash.match(/^#share=([^&]+)/)?.[1];
	const sharedTeams = shared ? decodeShare(decodeURIComponent(shared)) : null;
	if (sharedTeams)
		return {
			members: sharedTeams.flatMap((team) => team.members),
			groupCount: sharedTeams.length,
			teams: sharedTeams,
			fromShare: true,
		};
	try {
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as {
			members?: Member[];
			groupCount?: number;
			teams?: Team[];
		} | null;
		if (stored?.members?.length)
			return {
				members: stored.members,
				groupCount: Math.min(6, Math.max(2, stored.groupCount ?? 3)),
				teams: stored.teams ?? [],
				fromShare: false,
			};
	} catch {
		/* Invalid local data falls back to the default placeholder roster. */
	}
	return {
		members: makeMembers(defaultMemberNames),
		groupCount: 3,
		teams: [] as Team[],
		fromShare: false,
	};
}

function buildShareUrl(teams: Team[]) {
	return `${window.location.origin}${window.location.pathname}#share=${encodeURIComponent(encodeShare(teams))}`;
}

function AppProvider({ children }: { children: ReactNode }) {
	const initial = useMemo(readInitialState, []);
	const [members, setMembers] = useState<Member[]>(initial.members);
	const [groupCount, setGroupCount] = useState(initial.groupCount);
	const [teams, setTeams] = useState<Team[]>(initial.teams);
	const [toast, setToast] = useState<Toast>(null);
	const [shareUrl, setShareUrl] = useState(() =>
		initial.teams.length ? buildShareUrl(initial.teams) : '',
	);
	const [qrCode, setQrCode] = useState('');
	const [reveal, setReveal] = useState<Reveal>(null);
	const revealDone = useRef<(() => void) | null>(null);

	const startReveal = useCallback((next: Team[], onDone?: () => void) => {
		revealDone.current = onDone ?? null;
		setReveal({ teams: next, token: Date.now() });
	}, []);
	const endReveal = useCallback(() => {
		setReveal((current) => (current ? null : current));
		const done = revealDone.current;
		revealDone.current = null;
		done?.();
	}, []);

	const notify = useCallback((text: string) => {
		const id = Date.now();
		setToast({ id, text });
		window.setTimeout(
			() => setToast((current) => (current?.id === id ? null : current)),
			2200,
		);
	}, []);

	useEffect(() => {
		if (!initial.fromShare)
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ members, groupCount, teams }),
			);
	}, [groupCount, initial.fromShare, members, teams]);

	useEffect(() => {
		if (!shareUrl) return;
		QRCode.toDataURL(shareUrl, {
			width: 240,
			margin: 1,
			color: { dark: '#1d1d1f', light: '#ffffff' },
		})
			.then(setQrCode)
			.catch(() => setQrCode(''));
	}, [shareUrl]);

	const addMember = useCallback(
		(rawName: string) => {
			const name = rawName.trim();
			if (!name) return '请输入钓友姓名';
			if (members.some((member) => member.name === name))
				return '该钓友已在名单中';
			setMembers((current) => [...current, { id: crypto.randomUUID(), name }]);
			return null;
		},
		[members],
	);

	const removeMember = useCallback(
		(id: string) =>
			setMembers((current) => current.filter((member) => member.id !== id)),
		[],
	);
	const clearMembers = useCallback(() => {
		setMembers([]);
		setTeams([]);
		setShareUrl('');
		notify('已清空钓友名单');
	}, [notify]);
	const usePreset = useCallback(() => {
		setMembers(makeMembers(presetNames));
		setGroupCount(3);
		setTeams([]);
		notify('已导入 9 位示例钓友');
	}, [notify]);

	const shuffleTeams = useCallback(
		(countOverride?: number) => {
			const count = countOverride ?? groupCount;
			if (members.length < 2) {
				notify('至少需要 2 位钓友');
				return null;
			}
			if (count > members.length) {
				notify('分组数量不能超过钓友人数');
				return null;
			}
			if (count !== groupCount) setGroupCount(count);
			const next = distribute(members, count);
			setTeams(next);
			setShareUrl('');
			return next;
		},
		[groupCount, members, notify],
	);

	const swapMembers = useCallback(
		(firstId: string, secondId: string) => {
			setTeams((current) => {
				const next = current.map((team) => ({
					...team,
					members: [...team.members],
				}));
				let first: { team: number; member: number } | null = null;
				let second: { team: number; member: number } | null = null;
				next.forEach((team, teamIndex) =>
					team.members.forEach((member, memberIndex) => {
						if (member.id === firstId)
							first = { team: teamIndex, member: memberIndex };
						if (member.id === secondId)
							second = { team: teamIndex, member: memberIndex };
					}),
				);
				if (!first || !second) return current;
				const a = first as { team: number; member: number };
				const b = second as { team: number; member: number };
				[next[a.team].members[a.member], next[b.team].members[b.member]] = [
					next[b.team].members[b.member],
					next[a.team].members[a.member],
				];
				return next;
			});
			setShareUrl('');
			notify('两位钓友已完成换位');
		},
		[notify],
	);

	const createShareUrl = useCallback(() => {
		const url = buildShareUrl(teams);
		setShareUrl(url);
		window.history.replaceState(
			null,
			'',
			`#share=${encodeURIComponent(encodeShare(teams))}`,
		);
		return url;
	}, [teams]);

	const value = useMemo<AppContextValue>(
		() => ({
			members,
			groupCount,
			teams,
			shareUrl,
			qrCode,
			toast,
			reveal,
			startReveal,
			endReveal,
			setGroupCount,
			addMember,
			removeMember,
			clearMembers,
			usePreset,
			shuffleTeams,
			swapMembers,
			createShareUrl,
			notify,
		}),
		[
			addMember,
			createShareUrl,
			endReveal,
			groupCount,
			members,
			notify,
			qrCode,
			clearMembers,
			removeMember,
			reveal,
			shareUrl,
			shuffleTeams,
			startReveal,
			swapMembers,
			teams,
			toast,
			usePreset,
		],
	);
	return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function AppHeader({
	flow,
	mode,
}: {
	flow: FlowControls;
	mode: 'entry' | 'result' | 'share';
}) {
	const labels = {
		entry: '钓友随机分队 · 竞技协同',
		result: '作钓编组系统',
		share: '钓队出征战报 · 发布会',
	} as const;
	const goBack = () => {
		if (flow.canGoBack) flow.pop();
		else {
			window.history.replaceState(null, '', window.location.pathname);
			window.location.reload();
		}
	};
	return (
		<div className='app-header'>
			<div className='brand-lockup'>
				{mode !== 'entry' ? (
					<button
						className='icon-button'
						type='button'
						onClick={goBack}
						aria-label='返回'>
						<ArrowLeftIcon />
					</button>
				) : (
					<span className='brand-mark'>
						<TargetIcon />
					</span>
				)}
				<span className='brand-copy'>
					<strong>{labels[mode]}</strong>
				</span>
			</div>
			<span className='header-badge'>
				{mode === 'entry'
					? 'PRO SQUAD'
					: mode === 'result'
						? 'MATCHED'
						: 'VERIFIED'}
			</span>
		</div>
	);
}

const entryScreen: FlowScreen = {
	id: 'entry',
	headerHeight: 56,
	header: (flow) => <AppHeader flow={flow} mode='entry' />,
	render: (flow) => <EntryScreen flow={flow} />,
};
const resultScreen: FlowScreen = {
	id: 'result',
	headerHeight: 56,
	header: (flow) => <AppHeader flow={flow} mode='result' />,
	render: (flow) => <ResultScreen flow={flow} />,
};
const shareScreen: FlowScreen = {
	id: 'share',
	headerHeight: 56,
	header: (flow) => <AppHeader flow={flow} mode='share' />,
	render: (flow) => <ShareScreen flow={flow} />,
};

function EntryScreen({ flow }: { flow: FlowControls }) {
	const {
		members,
		groupCount,
		setGroupCount,
		addMember,
		removeMember,
		clearMembers,
		usePreset,
		shuffleTeams,
		startReveal,
		notify,
	} = useApp();
	const [name, setName] = useState('');
	const [customGroupOpen, setCustomGroupOpen] = useState(groupCount > 4);
	const [customGroupDraft, setCustomGroupDraft] = useState(String(groupCount));
	const estimated =
		members.length > 0 ? Math.ceil(members.length / groupCount) : 0;

	const commitCustomGroup = useCallback(() => {
		const next = parseCustomGroupCount(customGroupDraft, groupCount);
		if (!customGroupDraft.trim()) {
			setCustomGroupDraft(String(groupCount));
			return;
		}
		setGroupCount(next);
		setCustomGroupDraft(String(next));
	}, [customGroupDraft, groupCount, setGroupCount]);
	const submit = () => {
		const error = addMember(name);
		if (error) return notify(error);
		setName('');
		notify('钓友已加入本次编组');
	};
	const start = () => {
		const count = customGroupOpen
			? parseCustomGroupCount(customGroupDraft, groupCount)
			: groupCount;
		if (customGroupOpen) setCustomGroupDraft(String(count));
		const next = shuffleTeams(count);
		if (next) startReveal(next, () => flow.push(resultScreen));
	};
	return (
		<MobileScroll className='app-screen'>
			<main className='screen-content entry-content' data-testid='entry-screen'>
				<section className='hero-card'>
					<span className='eyebrow'>
						<i /> ANGLER MATRIX 3.0
					</span>
					<h1>
						作钓编组。
						<br />
						<em>重构默契。</em>
					</h1>
					<p>为每一次出发快速完成公平、无偏的随机编组。</p>
					<div className='hero-meta'>
						<span>简单录入 · 即时分组</span>
						<span>本地安全存储</span>
					</div>
				</section>
				<section className='panel roster-panel'>
					<div className='section-title'>
						<span>
							<PersonIcon />
							钓友名单
						</span>
						<div className='roster-actions'>
							<button
								type='button'
								className='ghost-small ghost-icon'
								disabled={members.length === 0}
								onClick={clearMembers}
								aria-label='一键清除钓友名单'
								data-testid='clear-members-button'>
								<TrashIcon />
							</button>
							<button type='button' className='ghost-small' onClick={usePreset}>
								<EnterIcon />
								导入预设
							</button>
						</div>
					</div>
					<div className='add-row'>
						<input
							value={name}
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => event.key === 'Enter' && submit()}
							placeholder='输入姓名，如：阿强'
							aria-label='钓友姓名'
							data-testid='member-input'
						/>
						<button type='button' className='add-button' onClick={submit}>
							<PlusIcon />
							录入
						</button>
					</div>
					<div className='status-line'>
						<span>
							已就绪 <strong>{members.length}</strong> 位钓友
						</span>
						<span>
							<i />
							名单已保存
						</span>
					</div>
					<div className='member-cloud' aria-label='已录入钓友'>
						{members.map((member, index) => (
							<span className='member-chip' key={member.id}>
								<b>{String(index + 1).padStart(2, '0')}</b>
								{member.name}
								<button
									type='button'
									onClick={() => removeMember(member.id)}
									aria-label={`删除${member.name}`}>
									<Cross2Icon />
								</button>
							</span>
						))}
					</div>
				</section>
				<section className='panel rules-panel'>
					<div className='section-title'>
						<span>
							<MixerHorizontalIcon />
							分组设置
						</span>
						<small>RULES</small>
					</div>
					<label className='field-caption'>选择分成几组</label>
					<div className='group-picker'>
						{[2, 3, 4].map((count) => (
							<button
								key={count}
								type='button'
								className={
									!customGroupOpen && count === groupCount ? 'active' : ''
								}
								onClick={() => {
									setCustomGroupOpen(false);
									setGroupCount(count);
								}}>
								{count} 组
							</button>
						))}
						<button
							type='button'
							className={customGroupOpen ? 'active' : ''}
							onClick={() => {
								setCustomGroupOpen(true);
								setCustomGroupDraft(String(groupCount));
							}}>
							自定义
						</button>
					</div>
					{customGroupOpen ? (
						<label className='custom-group-row'>
							<span>分成</span>
							<input
								type='text'
								inputMode='numeric'
								pattern='[0-9]*'
								value={customGroupDraft}
								onChange={(event) =>
									setCustomGroupDraft(
										event.target.value.replace(/\D/g, '').slice(0, 2),
									)
								}
								onBlur={commitCustomGroup}
								onKeyDown={(event) => {
									if (event.key === 'Enter') {
										event.preventDefault();
										commitCustomGroup();
										event.currentTarget.blur();
									}
								}}
								aria-label='自定义分组数量'
							/>
							<span>组</span>
							<small>最多不能超过当前钓友人数</small>
						</label>
					) : null}
					<div className='projection-card'>
						<RocketIcon />
						<span>
							<small>分组预览</small>
							<strong>
								预计生成 {groupCount} 支钓队，每组约 {estimated} 人
							</strong>
						</span>
					</div>
					<div className='rule-note'>
						<CheckCircledIcon />
						<span>
							<strong>完全随机，保证公平，人数均匀</strong>
							<small>人数无法整除时，各组人数最多相差 1 人。</small>
						</span>
					</div>
					{/* <div className='rule-note'>
						<CheckCircledIcon />
						<span>
							<strong>自动保存在当前设备</strong>
							<small>名单与最近一次结果存入 localStorage。</small>
						</span>
					</div> */}
				</section>
				<button
					className='primary-action'
					type='button'
					onClick={start}
					data-testid='shuffle-button'>
					<span>开始随机分组</span>
					<ShuffleIcon />
				</button>
				<p className='privacy-note'>数据仅保存在你的浏览器中，不会上传服务器</p>
			</main>
			<ToastView />
		</MobileScroll>
	);
}

function ResultScreen({ flow }: { flow: FlowControls }) {
	const { teams, shuffleTeams, startReveal, swapMembers, createShareUrl, notify } =
		useApp();
	const [swapMode, setSwapMode] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const selectMember = (memberId: string) => {
		if (!swapMode) return;
		if (selected.includes(memberId)) return setSelected([]);
		if (!selected.length) {
			setSelected([memberId]);
			notify('再选择另一位钓友完成换位');
			return;
		}
		swapMembers(selected[0], memberId);
		setSelected([]);
		setSwapMode(false);
	};
	const openShare = () => {
		createShareUrl();
		flow.push(shareScreen);
	};
	return (
		<MobileScroll className='app-screen'>
			<main
				className='screen-content result-content'
				data-testid='result-screen'>
				<div className='result-hero'>
					<span className='eyebrow'>
						<i /> MATCH REVEAL {String(teams.length).padStart(2, '0')}
					</span>
					<h1>钓队已集结。</h1>
					<p>
						{teams.reduce((sum, team) => sum + team.members.length, 0)} 位钓友 ·{' '}
						{teams.length} 支队伍已就绪
					</p>
				</div>
				<div className='metrics'>
					<div>
						<strong>公平</strong>
						<small>随机洗牌</small>
					</div>
					<div>
						<strong>{teams.length} 支</strong>
						<small>战队分配</small>
					</div>
					<div>
						<strong>≤1 人</strong>
						<small>人数差值</small>
					</div>
				</div>
				<div className='team-stack'>
					{teams.map((team, index) => (
						<section className='team-card' key={team.id}>
							<div className='team-heading'>
								<span>
									<i className={`dot dot-${index}`} />
									<strong>{team.name}</strong>
									<small>随机序列 · 均匀分配</small>
								</span>
								<b>Boat {String(index + 1).padStart(2, '0')}</b>
							</div>
							<div className='team-meter'>
								<span style={{ width: `${100 - index * 3}%` }} />
								<b>{team.members.length}人</b>
							</div>
							<div className='team-members'>
								{team.members.map((member, memberIndex) => (
									<button
										type='button'
										className={`result-member ${selected.includes(member.id) ? 'selected' : ''}`}
										key={member.id}
										onClick={() => selectMember(member.id)}>
										<PersonIcon />
										<span>{member.name}</span>
										{memberIndex === 0 && <small>队长</small>}
									</button>
								))}
							</div>
						</section>
					))}
				</div>
				<div className='secondary-actions'>
					<button
						type='button'
						onClick={() => {
							const next = shuffleTeams();
							if (!next) return;
							setSelected([]);
							setSwapMode(false);
							startReveal(next, () => notify('已生成一套新的随机结果'));
						}}>
						<ReloadIcon />
						重新随机
					</button>
					<button
						type='button'
						className={swapMode ? 'active' : ''}
						onClick={() => {
							setSwapMode((value) => !value);
							setSelected([]);
						}}>
						<DragHandleDots2Icon />
						{swapMode ? '请选择两人' : '微调换人'}
					</button>
				</div>
				<button
					className='primary-action'
					type='button'
					onClick={openShare}
					data-testid='share-page-button'>
					<CameraIcon />
					<span>生成分享海报与链接</span>
				</button>
			</main>
			<ToastView />
		</MobileScroll>
	);
}

function ShareScreen({ flow }: { flow: FlowControls }) {
	const { teams, shareUrl, qrCode, createShareUrl, notify } = useApp();
	const activeUrl = shareUrl || buildShareUrl(teams);
	useEffect(() => {
		if (!shareUrl && teams.length) createShareUrl();
	}, [createShareUrl, shareUrl, teams.length]);
	const savePoster = async () => {
		await downloadPoster(
			teams,
			qrCode || (await QRCode.toDataURL(activeUrl, { width: 240, margin: 1 })),
		);
		notify('海报已生成并开始保存');
	};
	return (
		<MobileScroll className='app-screen'>
			<main className='screen-content share-content' data-testid='share-screen'>
				<div className='dispatch-line'>
					<span>
						<i /> LIVE DISPATCH
					</span>
					<b>SPEC // {String(teams.length).padStart(2, '0')}</b>
				</div>
				<section className='poster-card' id='share-poster'>
					<div className='poster-rings' />
					<div className='poster-heading'>
						<span className='poster-medal'>
							<TargetIcon />
						</span>
						<small>APEX ANGLER SPECIAL EVENT / 随机编组</small>
						<h1>水域集结，破浪出征。</h1>
						<p>钓友竞技拉练 · 最终编组名单</p>
					</div>
					<div className='poster-teams'>
						{teams.map((team, index) => (
							<article key={team.id}>
								<div>
									<b className={index === 0 ? 'inverse' : ''}>
										{String(index + 1).padStart(2, '0')} ·{' '}
										{shortTeamName(team.name)}
									</b>
									<span>
										SECTOR // {String.fromCharCode(65 + index)}01-
										{String.fromCharCode(65 + index)}08
									</span>
								</div>
								<p>
									<small>钓友编组</small>
									<strong>
										{team.members.map((member) => member.name).join(' / ')}
									</strong>
								</p>
							</article>
						))}
					</div>
					<div className='verified-line'>
						<CheckCircledIcon />
						<span>Angler RNG · 本地无偏随机认证</span>
					</div>
					<div className='qr-row'>
						<span className='qr-box'>
							{qrCode ? (
								<img src={qrCode} alt='分组分享二维码' />
							) : (
								<Link2Icon />
							)}
						</span>
						<span>
							<strong>扫码查看分组详情</strong>
							<small>链接中已携带本次编组数据</small>
						</span>
					</div>
				</section>
				<button className='primary-action' type='button' onClick={savePoster}>
					<CameraIcon />
					<span>保存出征海报</span>
				</button>
				<button
					className='text-action'
					type='button'
					onClick={() =>
						flow.canGoBack ? flow.pop() : window.location.reload()
					}>
					<DownloadIcon />
					返回调整分组
				</button>
			</main>
			<ToastView />
		</MobileScroll>
	);
}

const SPIN_MS = 1150;
const DONE_MS = 620;

function ShuffleOverlay() {
	const { reveal, endReveal } = useApp();
	const [snapshot, setSnapshot] = useState<Team[]>([]);
	useEffect(() => {
		if (reveal) setSnapshot(reveal.teams);
	}, [reveal]);
	const teams = reveal?.teams ?? snapshot;
	const names = useMemo(
		() => teams.flatMap((team) => team.members.map((member) => member.name)),
		[teams],
	);
	const dealOrder = useMemo(() => {
		const rounds = teams.reduce(
			(max, team) => Math.max(max, team.members.length),
			0,
		);
		const slots: Array<{ team: number; member: number }> = [];
		for (let round = 0; round < rounds; round += 1)
			teams.forEach((team, teamIndex) => {
				if (team.members[round]) slots.push({ team: teamIndex, member: round });
			});
		return slots;
	}, [teams]);
	const [phase, setPhase] = useState<'spin' | 'deal' | 'done'>('spin');
	const [rolling, setRolling] = useState('');
	const [dealt, setDealt] = useState(0);

	useEffect(() => {
		if (!reveal) return;
		setPhase('spin');
		setDealt(0);
		const roll = window.setInterval(() => {
			setRolling(names[Math.floor(Math.random() * names.length)] ?? '');
		}, 70);
		const toDeal = window.setTimeout(() => setPhase('deal'), SPIN_MS);
		return () => {
			window.clearInterval(roll);
			window.clearTimeout(toDeal);
		};
	}, [names, reveal]);

	useEffect(() => {
		if (!reveal || phase !== 'deal') return;
		if (dealt >= dealOrder.length) {
			const settle = window.setTimeout(() => setPhase('done'), 240);
			return () => window.clearTimeout(settle);
		}
		const step = Math.max(45, Math.min(130, 950 / dealOrder.length));
		const tick = window.setTimeout(() => setDealt((value) => value + 1), step);
		return () => window.clearTimeout(tick);
	}, [dealOrder.length, dealt, phase, reveal]);

	useEffect(() => {
		if (!reveal || phase !== 'done') return;
		const exit = window.setTimeout(endReveal, DONE_MS);
		return () => window.clearTimeout(exit);
	}, [endReveal, phase, reveal]);

	const revealedByTeam = teams.map(
		(_, teamIndex) =>
			phase === 'done'
				? teams[teamIndex].members.length
				: dealOrder
						.slice(0, dealt)
						.filter((slot) => slot.team === teamIndex).length,
	);
	const progress =
		phase === 'spin'
			? 0.2
			: phase === 'done'
				? 1
				: 0.2 + 0.8 * (dealt / Math.max(dealOrder.length, 1));
	const caption =
		phase === 'spin' ? '洗牌中' : phase === 'deal' ? '发牌中' : '编组完成';
	const dealingSlot =
		dealOrder[Math.min(Math.max(dealt - 1, 0), dealOrder.length - 1)];
	const dealingName = dealingSlot
		? (teams[dealingSlot.team]?.members[dealingSlot.member]?.name ?? '')
		: '';

	return (
		<div
			className={`shuffle-overlay ${reveal ? 'visible' : ''} phase-${phase}`}
			role='status'
			aria-live='polite'
			onClick={reveal ? endReveal : undefined}
			data-testid='shuffle-overlay'>
			<div className='shuffle-stage'>
				<span className='eyebrow'>
					<i /> ANGLER RNG · FAIR SHUFFLE
				</span>
				<div className='shuffle-dial'>
					{phase === 'done' ? (
						<CheckCircledIcon />
					) : (
						<strong key={phase === 'spin' ? rolling : dealt}>
							{phase === 'spin' ? rolling : dealingName}
						</strong>
					)}
				</div>
				<div className='shuffle-progress'>
					<span style={{ width: `${Math.round(progress * 100)}%` }} />
				</div>
				<div className='shuffle-caption'>
					<strong>{caption}</strong>
					<small>
						{phase === 'spin'
							? '正在打乱全部钓友顺序'
							: phase === 'deal'
								? `已入队 ${dealt} / ${dealOrder.length} 人`
								: `${teams.length} 支钓队已集结`}
					</small>
				</div>
				<div className='shuffle-teams'>
					{teams.map((team, teamIndex) => (
						<div className='shuffle-team' key={team.id}>
							<span>
								<i className={`dot dot-${teamIndex}`} />
								{team.name}
							</span>
							<div className='shuffle-slots'>
								{team.members.map((member, memberIndex) =>
									memberIndex < revealedByTeam[teamIndex] ? (
										<b className='shuffle-slot filled' key={member.id}>
											{member.name}
										</b>
									) : (
										<b className='shuffle-slot pending' key={member.id} />
									),
								)}
							</div>
						</div>
					))}
				</div>
				<small className='shuffle-hint'>点击任意处跳过</small>
			</div>
		</div>
	);
}

function ToastView() {
	const { toast } = useApp();
	return (
		<div className={`app-toast ${toast ? 'visible' : ''}`} role='status'>
			<CheckCircledIcon />
			{toast?.text ?? ''}
		</div>
	);
}
function shortTeamName(name: string) {
	return name.split('·').pop()?.trim() ?? name;
}
function loadImage(src: string) {
	return new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = reject;
		image.src = src;
	});
}

async function downloadPoster(teams: Team[], qrCode: string) {
	await document.fonts.ready;
	const canvas = document.createElement('canvas');
	canvas.width = 1080;
	canvas.height = 1440;
	const context = canvas.getContext('2d');
	if (!context) return;
	context.fillStyle = '#f5f5f7';
	context.fillRect(0, 0, 1080, 1440);
	context.fillStyle = '#ffffff';
	roundedRect(context, 70, 60, 940, 1320, 54);
	context.fill();
	context.fillStyle = '#1d1d1f';
	context.textAlign = 'center';
	context.font = '700 62px Hanken Grotesk, sans-serif';
	context.fillText('水域集结，破浪出征。', 540, 190);
	context.fillStyle = '#6e6e73';
	context.font = '400 28px Hanken Grotesk, sans-serif';
	context.fillText('APEX ANGLER · 最终编组名单', 540, 242);
	let y = 315;
	teams.forEach((team, index) => {
		context.fillStyle = '#fafafc';
		roundedRect(context, 130, y, 820, 165, 30);
		context.fill();
		context.strokeStyle = 'rgba(0,0,0,.08)';
		context.lineWidth = 2;
		context.stroke();
		context.textAlign = 'left';
		context.fillStyle = '#1d1d1f';
		context.font = '700 31px Hanken Grotesk, sans-serif';
		context.fillText(
			`${String(index + 1).padStart(2, '0')} · ${shortTeamName(team.name)}`,
			172,
			y + 55,
		);
		context.fillStyle = '#86868b';
		context.font = '500 22px Hanken Grotesk, sans-serif';
		context.fillText('钓友编组', 172, y + 113);
		context.fillStyle = '#1d1d1f';
		context.textAlign = 'right';
		context.font = '700 27px Hanken Grotesk, sans-serif';
		context.fillText(
			team.members.map((member) => member.name).join(' / '),
			908,
			y + 113,
		);
		y += 188;
	});
	const qr = await loadImage(qrCode);
	context.drawImage(qr, 140, 1125, 170, 170);
	context.textAlign = 'left';
	context.fillStyle = '#1d1d1f';
	context.font = '700 29px Hanken Grotesk, sans-serif';
	context.fillText('扫码查看分组详情', 345, 1198);
	context.fillStyle = '#86868b';
	context.font = '400 22px Hanken Grotesk, sans-serif';
	context.fillText('无后端 · 链接携带本次编组数据', 345, 1240);
	context.textAlign = 'center';
	context.font = '600 20px ui-monospace, monospace';
	context.fillText('ANGLER RNG · FAIR SHUFFLE VERIFIED', 540, 1340);
	const link = document.createElement('a');
	link.download = `钓友分组海报-${new Date().toISOString().slice(0, 10)}.png`;
	link.href = canvas.toDataURL('image/png');
	link.click();
}

function roundedRect(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
) {
	context.beginPath();
	context.roundRect(x, y, width, height, radius);
}

export default function Prototype() {
	const shared = window.location.hash.startsWith('#share=');
	return (
		<AppProvider>
			<FlowStack initial={shared ? shareScreen : entryScreen} />
			<ShuffleOverlay />
		</AppProvider>
	);
}
