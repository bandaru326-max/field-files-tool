/**
 * Member File Sharing Portal - Client Logic
 * Handles Authentication, locked views, live updates, and data management.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Check Login State and Route accordingly
  updateNavbar();

  const loginForm = document.getElementById('login-form');
  const uploadForm = document.getElementById('upload-form');
  const recordsContainer = document.getElementById('records-container');

  // Page Routing Logic
  if (loginForm && uploadForm) {
    initPortalPage();
  }

  if (recordsContainer && !uploadForm) {
    initDashboardPage();
  }

  // Bind close triggers for modals globally if they exist on the page
  const previewModalClose = document.getElementById('preview-modal-close');
  if (previewModalClose) {
    previewModalClose.addEventListener('click', closeAllModals);
  }
  const deleteModalClose = document.getElementById('delete-modal-close');
  if (deleteModalClose) {
    deleteModalClose.addEventListener('click', closeAllModals);
  }
  const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
  if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', closeAllModals);
  }

  window.addEventListener('click', (e) => {
    const previewModal = document.getElementById('preview-modal');
    const deleteModal = document.getElementById('delete-modal');
    if (e.target === previewModal || e.target === deleteModal) {
      closeAllModals();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });

  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    themeToggle.textContent = savedTheme === 'light' ? '☀️' : '🌙';
    
    themeToggle.addEventListener('click', () => {
      const activeTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = activeTheme === 'light' ? 'dark' : 'light';
      
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      themeToggle.textContent = newTheme === 'light' ? '☀️' : '🌙';
    });
  }

  const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async () => {
      if (!recordToDeleteId) return;

      try {
        const res = await fetch(`/api/uploads/${recordToDeleteId}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });
        
        if (res.status === 401) {
          sessionStorage.clear();
          window.location.replace('/upload');
          return;
        }

        const result = await res.json();

        if (res.ok) {
          closeAllModals();
          const uploadForm = document.getElementById('upload-form');
          if (uploadForm) {
            fetchHistory();
          } else {
            fetchDashboardUploads();
          }
        } else {
          alert('Failed to delete file: ' + result.error);
        }
      } catch (err) {
        console.error(err);
        alert('Network error when attempting to delete.');
      }
    });
  }
});

// Helper: Get auth headers for Fetch requests
function getAuthHeaders() {
  return {
    'x-user-role': sessionStorage.getItem('user_role') || '',
    'x-user-id': sessionStorage.getItem('user_id') || '',
    'x-auth-token': sessionStorage.getItem('auth_token') || ''
  };
}

// Update Header Navigation dynamically based on session role
function updateNavbar() {
  const navList = document.getElementById('nav-links-list');
  if (!navList) return;

  const role = sessionStorage.getItem('user_role');
  const userName = sessionStorage.getItem('user_name');

  let navHtml = '';

  if (role === 'admin') {
    navHtml = `
      <li><a href="/upload" id="nav-upload-link">Upload Files</a></li>
      <li><a href="/dashboard" id="nav-dashboard-link">Dashboard</a></li>
      <li><a href="#" id="nav-logout-btn" style="color: var(--error);">Logout</a></li>
    `;
  } else if (role === 'operator') {
    navHtml = `
      <li><a href="#" id="nav-logout-btn" style="color: var(--error);">Logout</a></li>
    `;
  } else {
    navHtml = '';
  }

  navList.innerHTML = navHtml;

  // Bind Logout Button
  const logoutBtn = document.getElementById('nav-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      sessionStorage.clear();
      window.location.replace('/upload');
    });
  }
}

// Global Alert Handler
function showAlert(type, message) {
  const alertBox = document.getElementById('alert-box');
  const alertMessage = document.getElementById('alert-message');
  const alertIcon = document.getElementById('alert-icon');

  if (!alertBox) return;

  alertBox.className = `alert alert-${type}`;
  alertMessage.textContent = message;
  
  if (type === 'success') {
    alertIcon.textContent = '✅';
  } else {
    alertIcon.textContent = '❌';
  }
  
  alertBox.style.display = 'flex';
  alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ----------------------------------------------------
// PORTAL PAGE IMPLEMENTATION (LOGIN + UPLOAD FORM)
// ----------------------------------------------------
function initPortalPage() {
  const loginCard = document.getElementById('login-card');
  const loginForm = document.getElementById('login-form');
  const loginUsername = document.getElementById('login-username');
  const loginPassword = document.getElementById('login-password');
  const loginErrorMsg = document.getElementById('login-error-msg');
  const loginErrorText = document.getElementById('login-error-text');
  const loginSubmitBtn = document.getElementById('login-submit-btn');

  const uploadContainer = document.getElementById('upload-container');
  const uploadForm = document.getElementById('upload-form');
  const adminMemberSelect = document.getElementById('member-select');
  const memberSelectHidden = document.getElementById('member-select-hidden');
  const uploadDateInput = document.getElementById('upload-date-input');

  if (uploadDateInput) {
    uploadDateInput.value = new Date().toISOString().split('T')[0];
  }

  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const filePreviewBox = document.getElementById('file-preview-box');
  const addMoreContainer = document.getElementById('add-more-container');
  const addMoreBtn = document.getElementById('add-more-btn');
  const submitBtn = document.getElementById('submit-btn');

  let selectedFiles = [];

  if (addMoreBtn) {
    addMoreBtn.addEventListener('click', () => fileInput.click());
  }

  // check if session already exists
  const role = sessionStorage.getItem('user_role');
  const userId = sessionStorage.getItem('user_id');
  const userName = sessionStorage.getItem('user_name');

  if (role && userId) {
    showPortalUploadForm(role, userId, userName);
  } else {
    document.body.style.overflow = 'hidden';
  }

  // Handle Login Submission
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Signing In...';
    loginErrorMsg.style.display = 'none';

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.value.trim(),
          password: loginPassword.value
        })
      });

      const result = await response.json();

      if (response.ok) {
        // Store Session
        sessionStorage.setItem('user_role', result.role);
        sessionStorage.setItem('user_id', result.id);
        sessionStorage.setItem('user_name', result.name);
        sessionStorage.setItem('auth_token', result.token);

        updateNavbar();

        showPortalUploadForm(result.role, result.id, result.name);
      } else {
        throw new Error(result.error || 'Login failed');
      }
    } catch (err) {
      loginErrorText.textContent = err.message;
      loginErrorMsg.style.display = 'flex';
      loginCard.classList.add('shake');
      setTimeout(() => loginCard.classList.remove('shake'), 400);
      loginPassword.value = '';
      loginPassword.focus();
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = 'Sign In';
    }
  });

  async function showPortalUploadForm(role, id, name) {
    document.body.style.overflow = 'auto';
    loginCard.style.display = 'none';
    uploadContainer.style.display = 'block';

    const adminDropdownWrapper = document.getElementById('admin-member-dropdown-wrapper');
    
    // Hydrate Welcome message above fields
    const portalWelcomeMsg = document.getElementById('portal-welcome-msg');
    const portalWelcomeName = document.getElementById('portal-welcome-name');
    if (portalWelcomeMsg && portalWelcomeName) {
      portalWelcomeName.textContent = name;
      portalWelcomeMsg.style.display = 'block';
    }
    const adminMemberSelect = document.getElementById('member-select');
    const operatorLockedWrapper = document.getElementById('operator-locked-wrapper');
    const operatorDisplayName = document.getElementById('operator-display-name');
    const memberSelectHidden = document.getElementById('member-select-hidden');

    if (role === 'admin') {
      // Show Dropdown Selector for Admin
      adminDropdownWrapper.style.display = 'block';
      adminMemberSelect.disabled = false;
      adminMemberSelect.required = true;
      
      // Hide and Disable Locked Input
      operatorLockedWrapper.style.display = 'none';
      memberSelectHidden.disabled = true;
      memberSelectHidden.required = false;

      // Populate Dropdown Choices
      await loadPortalAdminDropdown();
    } else {
      // Show Locked Input for Operator
      adminDropdownWrapper.style.display = 'none';
      adminMemberSelect.disabled = true;
      adminMemberSelect.required = false;

      operatorLockedWrapper.style.display = 'block';
      memberSelectHidden.disabled = false;
      memberSelectHidden.required = true;
      
      operatorDisplayName.value = name;
      memberSelectHidden.value = id;
    }

    // Admins do not see "Your Upload History" section
    const historyPanel = document.getElementById('history-panel');
    if (historyPanel) {
      if (role === 'admin') {
        historyPanel.style.display = 'none';
      } else {
        historyPanel.style.display = 'block';
        fetchHistory();
      }
    }
  }

  // Load choices specifically for the Admin Dropdown
  async function loadPortalAdminDropdown() {
    const adminMemberSelect = document.getElementById('member-select');
    if (!adminMemberSelect || adminMemberSelect.children.length > 1) return; // Already populated

    try {
      const response = await fetch('/api/members', {
        headers: getAuthHeaders()
      });
      if (!response.ok) throw new Error('Failed to load members list');
      const members = await response.json();
      
      members.forEach(member => {
        const opt = document.createElement('option');
        opt.value = member.id;
        opt.textContent = member.name;
        adminMemberSelect.appendChild(opt);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // Drag & Drop Upload Zone Listeners
  ['dragenter', 'dragover'].forEach(eventName => {
    uploadZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    uploadZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
    }, false);
  });

  uploadZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = Array.from(dt.files);
    if (files.length > 0) {
      handleFilesAdded(files);
    }
  });

  uploadZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      handleFilesAdded(files);
    }
  });

  function handleFilesAdded(files) {
    let duplicateOrInvalid = false;
    
    files.forEach(file => {
      // Validate file size (10MB limit per file)
      if (file.size > 10 * 1024 * 1024) {
        showAlert('error', `File "${file.name}" exceeds the 10MB limit.`);
        duplicateOrInvalid = true;
        return;
      }
      
      // Prevent duplicates
      if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
        duplicateOrInvalid = true;
        return;
      }

      // Check max files limit (15 files)
      if (selectedFiles.length >= 15) {
        showAlert('error', 'Maximum limit of 15 files reached.');
        duplicateOrInvalid = true;
        return;
      }

      selectedFiles.push(file);
    });

    renderSelectedFiles();
  }

  window.removeSelectedFile = function(index) {
    const previewBox = document.getElementById('file-preview-box');
    const childRow = previewBox.children[index];
    if (childRow && childRow.dataset.url) {
      URL.revokeObjectURL(childRow.dataset.url);
    }

    selectedFiles.splice(index, 1);
    renderSelectedFiles();
  };

  function renderSelectedFiles() {
    filePreviewBox.innerHTML = '';
    
    if (selectedFiles.length === 0) {
      filePreviewBox.style.display = 'none';
      if (addMoreContainer) addMoreContainer.style.display = 'none';
      uploadZone.style.display = 'flex';
      fileInput.required = true;
      fileInput.value = '';
      return;
    }
    
    filePreviewBox.style.display = 'flex';
    if (addMoreContainer) addMoreContainer.style.display = 'block';
    uploadZone.style.display = 'none';
    fileInput.required = false;

    selectedFiles.forEach((file, idx) => {
      const fileRow = document.createElement('div');
      fileRow.className = 'selected-file-box';
      fileRow.style.display = 'flex';
      fileRow.style.margin = '0'; // reset margins
      fileRow.style.flexDirection = 'column';
      fileRow.style.alignItems = 'stretch';
      fileRow.style.gap = '0.75rem';

      let thumbText = '📁';
      let thumbStyle = '';
      
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        thumbStyle = `background-image: url('${url}'); background-size: cover; background-position: center;`;
        thumbText = '';
        fileRow.dataset.url = url;
      } else if (file.type === 'application/pdf') {
        thumbText = '📕';
      }

      fileRow.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <div class="file-info">
            <div class="file-thumb" style="${thumbStyle}">${thumbText}</div>
            <div>
              <div class="file-name-text" style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(file.name)}</div>
              <div class="file-size-text">${formatBytes(file.size)}</div>
            </div>
          </div>
          <button type="button" class="remove-file-btn" onclick="removeSelectedFile(${idx})" aria-label="Remove this file">&times;</button>
        </div>
        <div class="form-group" style="margin: 0; width: 100%;">
          <input type="text" class="file-remarks-input" data-index="${idx}" placeholder="Remarks for this file (required)..." required style="width: 100%; padding: 0.65rem; background: rgba(8, 9, 14, 0.4); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); color: #fff; font-family: inherit; font-size: 0.85rem; outline: none; transition: var(--transition-normal);" value="${escapeHTML(file.remarks || '')}">
        </div>
      `;
      filePreviewBox.appendChild(fileRow);
    });

    // Bind input change listeners to sync remarks back to selectedFiles array
    const remarksInputs = filePreviewBox.querySelectorAll('.file-remarks-input');
    remarksInputs.forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        selectedFiles[idx].remarks = e.target.value;
      });
    });
  }

  function resetFileSelection() {
    selectedFiles = [];
    renderSelectedFiles();
  }

  // Handle Form Submission
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (selectedFiles.length === 0) {
      showAlert('error', 'Please select at least one file to upload.');
      return;
    }

    if (!uploadForm.checkValidity()) return;

    submitBtn.disabled = true;
    const origBtnContent = submitBtn.innerHTML;
    submitBtn.innerHTML = `Uploading ${selectedFiles.length} file(s)...`;

    // Construct FormData manually from selectedFiles array
    const formData = new FormData();
    
    const memberIdVal = memberSelectHidden.disabled ? adminMemberSelect.value : memberSelectHidden.value;
    formData.append('memberId', memberIdVal);

    const activeType = document.getElementById('upload-type-hidden').value;
    formData.append('type', activeType);

    formData.append('reason', document.getElementById('reason-input').value);
    
    // Bottom global remarks input (preserved)
    formData.append('remarks', document.getElementById('remarks-input').value);

    selectedFiles.forEach(file => {
      formData.append('files', file);
      formData.append('fileRemarks', file.remarks || ''); // Individual remark per file
    });

    if (uploadDateInput) {
      formData.append('uploadDate', uploadDateInput.value);
    }

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      const result = await response.json();

      if (response.ok) {
        showAlert('success', `Successfully uploaded ${selectedFiles.length} file(s) to operator folder!`);
        uploadForm.reset();
        resetFileSelection();
        
        // Re-initialize today's date
        if (uploadDateInput) {
          uploadDateInput.value = new Date().toISOString().split('T')[0];
        }
        
        // Hydrate operator details back if operator
        if (sessionStorage.getItem('user_role') === 'operator') {
          const operatorDisplayName = document.getElementById('operator-display-name');
          if (operatorDisplayName) operatorDisplayName.value = sessionStorage.getItem('user_name');
          memberSelectHidden.value = sessionStorage.getItem('user_id');
          fetchHistory(); // Refresh history list
        }
      } else {
        throw new Error(result.error || 'Server rejected file upload');
      }
    } catch (err) {
      showAlert('error', 'Upload failed: ' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnContent;
    }
  });
}

// Load operator/admin personal history
let currentRecords = [];
async function fetchHistory() {
  const container = document.getElementById('records-container');
  if (!container) return;

  try {
    const res = await fetch('/api/uploads', {
      headers: getAuthHeaders()
    });

    if (res.status === 401) {
      sessionStorage.clear();
      window.location.replace('/upload');
      return;
    }

    if (!res.ok) throw new Error('Failed to load uploads');
    currentRecords = await res.json();

    document.getElementById('results-count').textContent = currentRecords.length;

    const role = sessionStorage.getItem('user_role');
    renderRecords(currentRecords, role === 'admin'); // Admin has delete rights on history cards
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center;">Unable to load your upload history.</p>`;
  }
}

// ----------------------------------------------------
// ADMIN DASHBOARD PAGE IMPLEMENTATION
// ----------------------------------------------------
let recordToDeleteId = null;

function initDashboardPage() {
  const filterForm = document.getElementById('filter-form');
  const searchInput = document.getElementById('search-input');
  const remarksInput = document.getElementById('remarks-search');
  const filterMember = document.getElementById('filter-member');
  const filterDate = document.getElementById('filter-date');
  const downloadFilteredBtn = document.getElementById('download-filtered-btn');

  // Modal Nodes
  const previewModal = document.getElementById('preview-modal');
  const previewModalClose = document.getElementById('preview-modal-close');
  const deleteModal = document.getElementById('delete-modal');
  const deleteModalClose = document.getElementById('delete-modal-close');
  const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
  const cancelDeleteBtn = document.getElementById('cancel-delete-btn');

  // Initial Load
  loadDashboardMembers();
  fetchDashboardUploads();

  // Set up live polling
  setInterval(fetchDashboardUploads, 5000);

  // Search Input Debouncing
  let debounceTimeout;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        fetchDashboardUploads();
      }, 300);
    });
  }

  if (remarksInput) {
    remarksInput.addEventListener('input', () => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        fetchDashboardUploads();
      }, 300);
    });
  }

  // Filter Listeners
  [filterMember, filterDate].forEach(elem => {
    if (elem) elem.addEventListener('change', fetchDashboardUploads);
  });

  // Download Filtered Action
  downloadFilteredBtn.addEventListener('click', () => {
    const downloadLinks = document.querySelectorAll('.records-grid a[download]');
    if (downloadLinks.length === 0) {
      alert('No matching files found to download.');
      return;
    }
    
    downloadLinks.forEach((link, idx) => {
      setTimeout(() => {
        link.click();
      }, idx * 250);
    });
  });

  // Modals closing triggers handled globally

  // Delete Action Confirm handled globally
}

// Load operator choices inside filter panel
async function loadDashboardMembers() {
  try {
    const response = await fetch('/api/members');
    if (!response.ok) throw new Error('Failed to fetch members');
    const members = await response.json();
    
    const filterMember = document.getElementById('filter-member');
    if (filterMember) {
      members.forEach(member => {
        const opt = document.createElement('option');
        opt.value = member.id;
        opt.textContent = member.name;
        filterMember.appendChild(opt);
      });
    }
  } catch (err) {
    console.error(err);
  }
}

// Retrieve records for admin view
async function fetchDashboardUploads() {
  const recordsContainer = document.getElementById('records-container');
  if (!recordsContainer) return;

  const searchInputElem = document.getElementById('search-input');
  const remarksInputElem = document.getElementById('remarks-search');
  const search = searchInputElem ? searchInputElem.value : '';
  const remarks = remarksInputElem ? remarksInputElem.value : '';
  const memberId = document.getElementById('filter-member').value;
  const filterDateElem = document.getElementById('filter-date');
  const dateVal = filterDateElem ? filterDateElem.value : '';

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (remarks) params.append('remarks', remarks);
  if (memberId) params.append('memberId', memberId);
  if (dateVal) params.append('date', dateVal);

  try {
    const res = await fetch(`/api/uploads?${params.toString()}`, {
      headers: getAuthHeaders()
    });
    
    if (res.status === 401) {
      sessionStorage.clear();
      window.location.replace('/upload');
      return;
    }
    
    if (!res.ok) throw new Error('API fetch failed');
    currentRecords = await res.json();

    updateDashboardStatistics(currentRecords);
    renderRecords(currentRecords, true); // true = show delete buttons for admin
  } catch (err) {
    console.error('Failed to load uploads:', err);
    recordsContainer.innerHTML = `
      <div class="empty-state" style="border-color: var(--error);">
        <div class="empty-state-icon" style="color: var(--error);">⚠️</div>
        <h3>Failed to Fetch uploads</h3>
        <p>Could not retrieve items from server.</p>
      </div>
    `;
  }
}

function updateDashboardStatistics(records) {
  const totalElem = document.getElementById('stat-total');
  const activeEngineersElem = document.getElementById('stat-active-engineers');
  const resultsCount = document.getElementById('results-count');

  if (!totalElem) return;

  const total = records.length;
  
  // Calculate active unique engineers (unique memberId count)
  const uniqueMemberIds = new Set(records.map(r => r.memberId));
  const activeEngineers = uniqueMemberIds.size;

  totalElem.textContent = total;
  if (activeEngineersElem) activeEngineersElem.textContent = activeEngineers;
  
  if (resultsCount) {
    resultsCount.textContent = total;
  }
}

// ----------------------------------------------------
// UI RENDERING ENGINE & MODAL CONTROLS
// ----------------------------------------------------
function renderRecords(records, showDeleteActions = false) {
  const container = document.getElementById('records-container');
  if (!container) return;

  if (records.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📂</div>
        <h3>No uploads found</h3>
        <p>No records fit the search query.</p>
      </div>
    `;
    return;
  }

  // Count uploads per member
  const memberCounts = {};
  records.forEach(r => {
    if (r.memberId) {
      memberCounts[r.memberId] = (memberCounts[r.memberId] || 0) + 1;
    }
  });

  // Group by Date
  const grouped = {};
  records.forEach(record => {
    const dateStr = formatDateDisplay(record.uploadDate);
    if (!grouped[dateStr]) {
      grouped[dateStr] = {
        label: dateStr,
        maxTimestamp: record.timestamp || 0,
        items: []
      };
    } else {
      grouped[dateStr].maxTimestamp = Math.max(grouped[dateStr].maxTimestamp, record.timestamp || 0);
    }
    grouped[dateStr].items.push(record);
  });

  // Sort groups descending by maxTimestamp (most recent first)
  const sortedGroups = Object.values(grouped).sort((a, b) => b.maxTimestamp - a.maxTimestamp);

  let htmlContent = '';

  sortedGroups.forEach(group => {
    htmlContent += `
      <div class="date-group">
        <div class="date-divider">
          <span class="date-divider-text">${group.label}</span>
          <div class="date-divider-line"></div>
        </div>
        <div class="records-grid">
    `;

    group.items.forEach(record => {
      const isImg = record.filename.match(/\.(jpeg|jpg|gif|png|webp)$/i);
      const isPdf = record.filename.match(/\.(pdf)$/i);
      let mediaPreview = '';
      
      if (isImg) {
        mediaPreview = `style="background-image: url('/${record.filePath}');"`;
      }

      // Secure API stream download URL
      const tokenVal = encodeURIComponent(sessionStorage.getItem('auth_token') || '');
      const roleVal = encodeURIComponent(sessionStorage.getItem('user_role') || '');
      const userIdVal = encodeURIComponent(sessionStorage.getItem('user_id') || '');
      const downloadUrl = `/api/download/${record.id}?token=${tokenVal}&role=${roleVal}&userId=${userIdVal}`;

      htmlContent += `
        <article class="record-card" aria-labelledby="title-${record.id}">
          <div class="record-media-container" ${mediaPreview} onclick="openPreview('${record.id}')" aria-label="View large preview of file">
            ${!isImg ? `<div class="record-media-placeholder">${isPdf ? '📕' : '📄'}</div>` : ''}
          </div>
          <div class="record-card-body">
            <h3 class="record-member-name" id="title-${record.id}">${record.memberName} (${memberCounts[record.memberId] || 0})</h3>
            <p class="record-reason">${escapeHTML(record.reason)}</p>
            ${record.remarks ? `<p class="record-remarks" style="margin-top: 0.25rem;"><strong>File Note:</strong> ${escapeHTML(record.remarks)}</p>` : ''}
            ${record.batchRemarks ? `<p class="record-remarks" style="margin-top: 0.25rem; opacity: 0.85;"><strong>Batch Note:</strong> ${escapeHTML(record.batchRemarks)}</p>` : ''}
          </div>
          <div class="record-card-footer">
            <time class="record-date" datetime="${record.uploadDate}">${formatTime(record.timestamp)}</time>
            <div class="record-actions">
              <button onclick="openPreview('${record.id}')" class="action-btn" title="View file preview" aria-label="View large preview of file" style="display: flex; align-items: center; gap: 0.25rem; background: rgba(155, 81, 224, 0.15); border: 1px solid rgba(155, 81, 224, 0.3); padding: 0.35rem 0.6rem; border-radius: var(--radius-sm); font-size: 0.75rem; cursor: pointer; color: #a5b4fc; font-weight: 500; outline: none; transition: var(--transition-fast);">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                View
              </button>
              <a href="${downloadUrl}" download="${record.originalName}" class="action-btn" title="Download direct file" aria-label="Download original file" style="display: flex; align-items: center; gap: 0.25rem; background: rgba(0, 242, 254, 0.1); border: 1px solid rgba(0, 242, 254, 0.2); padding: 0.35rem 0.6rem; border-radius: var(--radius-sm); font-size: 0.75rem; text-decoration: none; color: var(--accent-cyan); font-weight: 500;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Download
              </a>
              ${showDeleteActions ? `
              <button onclick="triggerDelete('${record.id}')" class="action-btn btn-delete" title="Delete record" aria-label="Delete this file record">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
              </button>
              ` : ''}
            </div>
          </div>
        </article>
      `;
    });

    htmlContent += `
        </div>
      </div>
    `;
  });

  container.innerHTML = htmlContent;
}

window.openPreview = function(recordId) {
  const record = currentRecords.find(r => r.id === recordId);
  if (!record) return;

  const previewModal = document.getElementById('preview-modal');
  const previewImage = document.getElementById('preview-image');
  const previewMemberName = document.getElementById('preview-member-name');
  const previewType = document.getElementById('preview-type');
  const previewReason = document.getElementById('preview-reason');
  const previewRemarks = document.getElementById('preview-remarks');
  const previewFilename = document.getElementById('preview-filename');

  const isImg = record.filename.match(/\.(jpeg|jpg|gif|png|webp)$/i);
  if (isImg) {
    previewImage.src = '/' + record.filePath;
    previewImage.style.display = 'block';
  } else {
    previewImage.style.display = 'none';
  }

  previewMemberName.textContent = record.memberName;
  previewType.textContent = record.type;
  previewReason.textContent = record.reason;
  
  if (record.remarks) {
    previewRemarks.textContent = record.remarks;
    previewRemarks.classList.remove('empty');
  } else {
    previewRemarks.textContent = 'No remarks provided';
    previewRemarks.classList.add('empty');
  }

  previewFilename.textContent = record.originalName;

  previewModal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.triggerDelete = function(recordId) {
  recordToDeleteId = recordId;
  const deleteModal = document.getElementById('delete-modal');
  deleteModal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

function closeAllModals() {
  const previewModal = document.getElementById('preview-modal');
  const deleteModal = document.getElementById('delete-modal');
  if (previewModal) previewModal.classList.remove('active');
  if (deleteModal) deleteModal.classList.remove('active');
  document.body.style.overflow = 'auto';
  recordToDeleteId = null;
}

// ----------------------------------------------------
// UTILITIES
// ----------------------------------------------------
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDateDisplay(dateString) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('en-US', options);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}
