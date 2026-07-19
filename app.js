const { url, publishableKey } = window.SUPABASE_CONFIG || {};
const supabase = window.supabase?.createClient(url, publishableKey);
const subCategories = { 冷冻: ['海鲜', '肉', '主食', '其他'], 冷藏: ['水果', '蔬菜', '饮料', '酱料', '其他'], 干货: ['其他'], 罐头: ['其他'], 速食: ['其他'], 零食: ['其他'] };
const $ = (id) => document.getElementById(id);
const itemForm = $('itemForm'), editForm = $('editForm'), summary = $('summary');
const addDialog = $('addDialog'), editDialog = $('editDialog'), actionDialog = $('actionDialog'), familyDialog = $('familyDialog'), authDialog = $('authDialog');
let currentUser, fridges = [], activeFridge, items = [], editingId, actionItemId, isSignup = false;

function setModal(dialog, open) { dialog.classList.toggle('hidden', !open); document.body.classList.toggle('modal-open', open); }
function today() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function refreshSubCategories(category, select) { const options = subCategories[category] || ['其他']; select.innerHTML = options.map((value) => `<option value="${value}">${value}</option>`).join(''); }
function itemFromRow(row) { return { id: row.id, name: row.name, category: row.category, subCategory: row.sub_category, quantity: row.quantity, time: row.recorded_on, expiryDate: row.expiry_date || '' }; }

async function initialize() {
  if (!supabase) { $('authMessage').textContent = '缺少 Supabase 配置。'; return; }
  const { data: { session } } = await supabase.auth.getSession();
  await handleSession(session);
  supabase.auth.onAuthStateChange((_event, session) => { handleSession(session); });
}

async function handleSession(session) {
  currentUser = session?.user;
  setModal(authDialog, !currentUser);
  if (!currentUser) return;
  $('accountBtn').textContent = (currentUser.user_metadata.display_name || currentUser.email || '我').slice(0, 1).toUpperCase();
  await acceptInviteFromUrl();
  await loadFridges();
}

async function loadFridges() {
  const { data: memberships, error } = await supabase.from('fridge_members').select('fridge_id, role').eq('user_id', currentUser.id);
  if (error) return showError(error);
  const ids = memberships.map((entry) => entry.fridge_id);
  const { data: fridgeRows, error: fridgeError } = ids.length ? await supabase.from('fridges').select('*').in('id', ids).order('created_at') : { data: [], error: null };
  if (fridgeError) return showError(fridgeError);
  fridges = fridgeRows.map((fridge) => ({ ...fridge, role: memberships.find((member) => member.fridge_id === fridge.id)?.role }));
  activeFridge = fridges.find((fridge) => fridge.id === activeFridge?.id) || fridges[0];
  $('fridgeSelect').innerHTML = fridges.map((fridge) => `<option value="${fridge.id}">${escapeHtml(fridge.name)}${fridge.role === 'admin' ? '' : ' · 共享'}</option>`).join('');
  if (activeFridge) $('fridgeSelect').value = activeFridge.id;
  await loadItems();
}

async function loadItems() {
  if (!activeFridge) { summary.innerHTML = '<div class="empty-state">正在准备你的冰箱…</div>'; return; }
  $('listTitle').textContent = activeFridge.name;
  $('syncStatus').textContent = '已同步到云端';
  $('manageFamilyBtn').hidden = activeFridge.role !== 'admin';
  const { data, error } = await supabase.from('items').select('*').eq('fridge_id', activeFridge.id).order('created_at', { ascending: false });
  if (error) return showError(error);
  items = data.map(itemFromRow); renderSummary();
}

function renderSummary() {
  if (!items.length) { summary.innerHTML = '<div class="empty-state">暂时没有物品，先添加一个吧。</div>'; return; }
  const groups = items.reduce((result, item) => { (result[item.subCategory] ||= []).push(item); return result; }, {});
  summary.innerHTML = Object.entries(groups).map(([name, group]) => `<section class="summary-card"><h2>${escapeHtml(name)} 汇总</h2><table class="summary-table"><thead><tr><th>物品</th><th>数量</th><th>到期时间</th></tr></thead><tbody>${group.map((item) => `<tr><td><button class="summary-name" data-id="${item.id}" type="button">${escapeHtml(item.name)}</button></td><td>${item.quantity}</td><td>${escapeHtml(item.expiryDate || '无')}</td></tr>`).join('')}</tbody></table></section>`).join('');
}

async function saveItem(item) {
  const row = { fridge_id: activeFridge.id, name: item.name, category: item.category, sub_category: item.subCategory, quantity: item.quantity, recorded_on: item.time, expiry_date: item.expiryDate || null };
  const query = item.id ? supabase.from('items').update(row).eq('id', item.id) : supabase.from('items').insert(row);
  const { error } = await query; if (error) return showError(error); await loadItems();
}
function formItem(form, id) { const data = new FormData(form); return { id, name: String(data.get('name')).trim(), category: String(data.get('category')), subCategory: String(data.get('subCategory')), quantity: Number(data.get('quantity')), time: String(data.get('time')), expiryDate: String(data.get('expiryDate')) }; }
function prepareForm(form) { form.reset(); form.elements.quantity.value = 1; form.elements.time.value = today(); form.elements.category.value = '冷藏'; refreshSubCategories('冷藏', form.elements.subCategory); }
function showError(error) { console.error(error); alert(error.message || '操作失败，请稍后重试。'); }

$('openAddDialogBtn').onclick = () => { prepareForm(itemForm); setModal(addDialog, true); $('name').focus(); };
$('cancelAddBtn').onclick = () => setModal(addDialog, false);
itemForm.onsubmit = async (event) => { event.preventDefault(); const item = formItem(itemForm); if (!item.name) return; await saveItem(item); setModal(addDialog, false); };
$('category').onchange = () => refreshSubCategories($('category').value, $('subCategory'));
summary.onclick = (event) => { const button = event.target.closest('.summary-name'); if (!button) return; actionItemId = Number(button.dataset.id); setModal(actionDialog, true); };
$('actionCancelBtn').onclick = () => setModal(actionDialog, false);
$('actionEditBtn').onclick = () => { const item = items.find((entry) => entry.id === actionItemId); if (!item) return; editingId = item.id; $('editName').value = item.name; $('editCategory').value = item.category; refreshSubCategories(item.category, $('editSubCategory')); $('editSubCategory').value = item.subCategory; $('editQuantity').value = item.quantity; $('editTime').value = item.time; $('editExpiryDate').value = item.expiryDate; setModal(actionDialog, false); setModal(editDialog, true); };
$('actionDeleteBtn').onclick = async () => { const item = items.find((entry) => entry.id === actionItemId); if (!item || !confirm(`确定删除“${item.name}”吗？`)) return; const { error } = await supabase.from('items').delete().eq('id', item.id); if (error) return showError(error); setModal(actionDialog, false); await loadItems(); };
$('cancelEditBtn').onclick = () => setModal(editDialog, false);
$('editCategory').onchange = () => refreshSubCategories($('editCategory').value, $('editSubCategory'));
editForm.onsubmit = async (event) => { event.preventDefault(); await saveItem(formItem(editForm, editingId)); setModal(editDialog, false); };

$('fridgeSelect').onchange = async () => { activeFridge = fridges.find((entry) => entry.id === $('fridgeSelect').value); await loadItems(); };
$('manageFamilyBtn').onclick = async () => { await loadMembers(); setModal(familyDialog, true); };
$('closeFamilyBtn').onclick = () => setModal(familyDialog, false);
async function loadMembers() { const { data, error } = await supabase.from('fridge_members').select('role, profiles(display_name)').eq('fridge_id', activeFridge.id); if (error) return showError(error); document.querySelector('.member-list').innerHTML = data.map((member) => `<div class="member-row"><span class="member-avatar">${escapeHtml((member.profiles?.display_name || '成').slice(0, 1))}</span><span>${escapeHtml(member.profiles?.display_name || '家庭成员')}</span><small>${member.role === 'admin' ? '管理员' : '成员'}</small></div>`).join(''); }
$('createInviteBtn').onclick = async () => { const { data, error } = await supabase.rpc('create_invite', { target_fridge: activeFridge.id, valid_days: 7 }); if (error) return showError(error); const link = `${location.origin}${location.pathname}?invite=${data}`; $('inviteResult').textContent = link; try { await navigator.clipboard.writeText(link); $('inviteResult').textContent = '邀请链接已复制，可发送给家人。'; } catch {} };
async function acceptInviteFromUrl() { const token = new URLSearchParams(location.search).get('invite'); if (!token) return; const { error } = await supabase.rpc('accept_invite', { invite_token: token }); history.replaceState({}, '', location.pathname); if (error) return showError(error); alert('你已加入家庭冰箱。'); }

$('authForm').onsubmit = async (event) => { event.preventDefault(); const email = $('email').value.trim(), password = $('password').value, displayName = $('displayName').value.trim(); $('authMessage').textContent = '处理中…'; const result = isSignup ? await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName || email.split('@')[0] } } }) : await supabase.auth.signInWithPassword({ email, password }); $('authMessage').textContent = result.error ? result.error.message : (isSignup ? '注册成功，请检查邮箱完成验证后登录。' : ''); };
$('signUpBtn').onclick = () => { isSignup = !isSignup; document.querySelector('.signup-only').classList.toggle('hidden', !isSignup); $('signInBtn').textContent = isSignup ? '注册并登录' : '登录'; $('signUpBtn').textContent = isSignup ? '已有账号？去登录' : '注册新账号'; };
$('accountBtn').onclick = async () => { if (confirm('要退出当前账号吗？')) await supabase.auth.signOut(); };
initialize();
