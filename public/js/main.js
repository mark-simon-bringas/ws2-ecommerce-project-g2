document.addEventListener('DOMContentLoaded', function() {

    // --- Desktop Navbar Dropdown Logic (No Change) ---
    const desktopNavLinks = document.querySelectorAll(".navbar-desktop .list-menu");
    const desktopSearchBtn = document.getElementById('desktop-search-btn');
    const dropdownContainer = document.querySelector(".dropdown");
    const contentPanels = document.querySelectorAll(".dropdown .con-1");

    if (desktopNavLinks.length > 0 && dropdownContainer) {
        const closeDropdown = () => {
            dropdownContainer.style.height = "0px";
            contentPanels.forEach(panel => panel.style.opacity = "0");
        };
        const openDropdown = (activeIndex) => {
            dropdownContainer.style.height = "330px";
            contentPanels.forEach((panel, index) => {
                panel.style.opacity = (index === activeIndex) ? "1" : "0";
            });
        };
        desktopNavLinks.forEach((link, index) => {
            link.addEventListener("mouseover", () => openDropdown(index));
        });
        if (desktopSearchBtn) {
            desktopSearchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const searchPanelIndex = 6;
                const isSearchOpen = dropdownContainer.style.height === "330px" && contentPanels[searchPanelIndex].style.opacity === "1";
                isSearchOpen ? closeDropdown() : openDropdown(searchPanelIndex);
            });
        }
        dropdownContainer.addEventListener("mouseleave", closeDropdown);
    }

    // --- Desktop User Dropdown Menu Logic (No Change) ---
    const userMenuBtn = document.getElementById('user-menu-btn');
    const userDropdown = document.getElementById('user-dropdown');
    if (userMenuBtn && userDropdown) {
        userMenuBtn.addEventListener('click', (event) => {
            event.preventDefault();
            userDropdown.classList.toggle('is-active');
        });
        window.addEventListener('click', (event) => {
            if (!userMenuBtn.contains(event.target) && !userDropdown.contains(event.target)) {
                userDropdown.classList.remove('is-active');
            }
        });
    }

    // --- Mobile Overlay Logic (No Change) ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileSearchBtn = document.getElementById('mobile-search-btn');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    const searchOverlay = document.querySelector('.overlay#search-overlay');
    const mobileMenuCloseBtn = document.getElementById('mobile-menu-close-btn');
    const searchOverlayCloseBtn = document.getElementById('search-overlay-close-btn');
    const body = document.body;
    const openOverlay = (overlay) => {
        if (overlay) {
            overlay.classList.add('is-active');
            body.classList.add('overlay-active');
        }
    };
    const closeAllOverlays = () => {
        document.querySelectorAll('.overlay.is-active').forEach(overlay => {
            overlay.classList.remove('is-active');
        });
        body.classList.remove('overlay-active');
    };
    if (mobileMenuBtn) { mobileMenuBtn.addEventListener('click', (e) => { e.preventDefault(); openOverlay(mobileMenuOverlay); }); }
    if (mobileSearchBtn) { mobileSearchBtn.addEventListener('click', (e) => { e.preventDefault(); openOverlay(searchOverlay); }); }
    if (mobileMenuCloseBtn) { mobileMenuCloseBtn.addEventListener('click', (e) => { e.preventDefault(); closeAllOverlays(); }); }
    if (searchOverlayCloseBtn) { searchOverlayCloseBtn.addEventListener('click', (e) => { e.preventDefault(); closeAllOverlays(); }); }

    // --- REVAMPED: Admin Product Page Logic ---
    if (document.getElementById('nav-tabContent')) {

        // --- Import Tab Logic ---
        const importForm = document.getElementById('multi-import-form');
        if (importForm) {
            const resultsContainer = document.getElementById('results-container');
            const importActionBar = document.getElementById('import-action-bar');
            const selectedImportCountSpan = document.getElementById('selected-import-count');
            const searchForm = document.getElementById('search-form');

            const updateImportSelectionState = () => {
                const selectedCheckboxes = resultsContainer.querySelectorAll('.product-checkbox:checked');
                const count = selectedCheckboxes.length;
                selectedImportCountSpan.textContent = count;
                importActionBar.classList.toggle('is-active', count > 0);
            };

            resultsContainer.addEventListener('click', function(event) {
                const card = event.target.closest('.product-import-card');
                if (!card) return;
                const checkbox = card.querySelector('.product-checkbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    card.classList.toggle('is-selected', checkbox.checked);
                    updateImportSelectionState();
                }
            });

            if (searchForm) {
                const searchButton = document.getElementById('search-button');
                searchForm.addEventListener('submit', async function(event) {
                    event.preventDefault();
                    resultsContainer.innerHTML = '';
                    searchButton.disabled = true;
                    updateImportSelectionState();
                    try {
                        const formData = new FormData(searchForm);
                        const response = await fetch('/products/search', {
                            method: 'POST',
                            body: new URLSearchParams(formData)
                        });
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        const html = await response.text();
                        resultsContainer.innerHTML = html;
                    } catch (error) {
                        console.error('Search failed:', error);
                        resultsContainer.innerHTML = `<div class="col-12 mt-4"><div class="text-center p-5 dashboard-card"><p class="h4 text-body-secondary">Search failed. Please try again.</p></div></div>`;
                    } finally {
                        searchButton.disabled = false;
                        updateImportSelectionState();
                    }
                });
            }
            updateImportSelectionState();
        }

        // --- Inventory Tab Logic ---
        const inventoryTable = document.getElementById('inventory-table');
        if (inventoryTable) {
            const searchInput = document.getElementById('inventory-search-input');
            const brandFilter = document.getElementById('inventory-brand-filter');
            const sortSelect = document.getElementById('inventory-sort');
            const selectAllCheckbox = document.getElementById('select-all-inventory');
            const tableBody = inventoryTable.querySelector('tbody');
            const allRows = Array.from(tableBody.querySelectorAll('tr'));
            const deleteActionBar = document.getElementById('delete-action-bar');
            const selectedDeleteCountSpan = document.getElementById('selected-delete-count');
            const paginationContainer = document.getElementById('inventory-pagination');
            const rowsPerPage = 10;
            let currentPage = 1;

            const updateDeleteSelectionState = () => {
                const checkedCount = tableBody.querySelectorAll('.inventory-checkbox:checked').length;
                selectedDeleteCountSpan.textContent = checkedCount;
                deleteActionBar.classList.toggle('is-active', checkedCount > 0);
                const allCheckboxes = tableBody.querySelectorAll('.inventory-checkbox');
                selectAllCheckbox.checked = allCheckboxes.length > 0 && checkedCount === allCheckboxes.length;
            };

            const displayPage = (rows, page) => {
                currentPage = page;
                rows.forEach(row => row.style.display = 'none');
                const start = (page - 1) * rowsPerPage;
                const end = start + rowsPerPage;
                rows.slice(start, end).forEach(row => row.style.display = '');
                setupPagination(rows);
            };

            const setupPagination = (rows) => {
                paginationContainer.innerHTML = '';
                const pageCount = Math.ceil(rows.length / rowsPerPage);
                if (pageCount <= 1) return;

                const ul = document.createElement('ul');
                ul.className = 'pagination';

                // Prev button
                const prevLi = document.createElement('li');
                prevLi.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
                const prevA = document.createElement('a');
                prevA.className = 'page-link';
                prevA.href = '#';
                prevA.innerText = 'Previous';
                prevA.addEventListener('click', (e) => { e.preventDefault(); if(currentPage > 1) displayPage(rows, currentPage - 1); });
                prevLi.appendChild(prevA);
                ul.appendChild(prevLi);

                for (let i = 1; i <= pageCount; i++) {
                    const li = document.createElement('li');
                    li.className = `page-item ${i === currentPage ? 'active' : ''}`;
                    const a = document.createElement('a');
                    a.className = 'page-link';
                    a.href = '#';
                    a.innerText = i;
                    a.addEventListener('click', (e) => { e.preventDefault(); displayPage(rows, i); });
                    li.appendChild(a);
                    ul.appendChild(li);
                }

                // Next button
                const nextLi = document.createElement('li');
                nextLi.className = `page-item ${currentPage === pageCount ? 'disabled' : ''}`;
                const nextA = document.createElement('a');
                nextA.className = 'page-link';
                nextA.href = '#';
                nextA.innerText = 'Next';
                nextA.addEventListener('click', (e) => { e.preventDefault(); if(currentPage < pageCount) displayPage(rows, currentPage + 1); });
                nextLi.appendChild(nextA);
                ul.appendChild(nextLi);

                paginationContainer.appendChild(ul);
            };

            const processTable = () => {
                // 1. Filter
                const searchTerm = searchInput.value.toLowerCase();
                const selectedBrand = brandFilter.value;
                const visibleRows = allRows.filter(row => {
                    const nameAndSku = row.cells[2].textContent.toLowerCase() + row.cells[3].textContent.toLowerCase();
                    const brand = row.dataset.brand;
                    const matchesSearch = nameAndSku.includes(searchTerm);
                    const matchesBrand = !selectedBrand || brand === selectedBrand;
                    return matchesSearch && matchesBrand;
                });

                // 2. Sort
                const sortValue = sortSelect.value;
                visibleRows.sort((a, b) => {
                    const aName = a.dataset.name;
                    const bName = b.dataset.name;
                    const aPrice = parseFloat(a.dataset.price);
                    const bPrice = parseFloat(b.dataset.price);

                    switch (sortValue) {
                        case 'name-asc': return aName.localeCompare(bName);
                        case 'name-desc': return bName.localeCompare(aName);
                        case 'price-asc': return aPrice - bPrice;
                        case 'price-desc': return bPrice - aPrice;
                        default: return 0;
                    }
                });

                // 3. Re-append to DOM and Paginate
                tableBody.innerHTML = '';
                visibleRows.forEach(row => tableBody.appendChild(row));
                displayPage(visibleRows, 1);
            };

            searchInput.addEventListener('input', processTable);
            brandFilter.addEventListener('change', processTable);
            sortSelect.addEventListener('change', processTable);

            selectAllCheckbox.addEventListener('change', () => {
                tableBody.querySelectorAll('.inventory-checkbox').forEach(checkbox => {
                    checkbox.checked = selectAllCheckbox.checked;
                });
                updateDeleteSelectionState();
            });

            tableBody.addEventListener('change', (e) => {
                if (e.target.classList.contains('inventory-checkbox')) {
                    updateDeleteSelectionState();
                }
            });
            
            // Initial Load
            updateDeleteSelectionState();
            processTable();
        }
    }
});