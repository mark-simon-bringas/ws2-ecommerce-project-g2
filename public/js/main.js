document.addEventListener('DOMContentLoaded', function() {

    // --- Desktop Navbar Dropdown Logic ---
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
            dropdownContainer.style.height = "280px";
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
                const searchPanelIndex = 4;
                const isSearchOpen = dropdownContainer.style.height === "280px" && contentPanels[searchPanelIndex].style.opacity === "1";
                isSearchOpen ? closeDropdown() : openDropdown(searchPanelIndex);
            });
        }
        dropdownContainer.addEventListener("mouseleave", closeDropdown);
    }

    // --- Desktop User Dropdown Menu Logic ---
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

    // --- Mobile Overlay Logic ---
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
            body.style.overflow = 'hidden';
        }
    };
    const closeAllOverlays = () => {
        document.querySelectorAll('.overlay.is-active').forEach(overlay => {
            overlay.classList.remove('is-active');
        });
        body.style.overflow = '';
    };
    if (mobileMenuBtn) { mobileMenuBtn.addEventListener('click', (e) => { e.preventDefault(); openOverlay(mobileMenuOverlay); }); }
    if (mobileSearchBtn) { mobileSearchBtn.addEventListener('click', (e) => { e.preventDefault(); openOverlay(searchOverlay); }); }
    if (mobileMenuCloseBtn) { mobileMenuCloseBtn.addEventListener('click', (e) => { e.preventDefault(); closeAllOverlays(); }); }
    if (searchOverlayCloseBtn) { searchOverlayCloseBtn.addEventListener('click', (e) => { e.preventDefault(); closeAllOverlays(); }); }

    // --- Product Carousel Navigation Logic ---
    const carouselSections = document.querySelectorAll('.product-carousel-section');
    carouselSections.forEach(section => {
        const carousel = section.querySelector('.product-carousel');
        const prevBtn = section.querySelector('.carousel-nav-btn.prev');
        const nextBtn = section.querySelector('.carousel-nav-btn.next');

        if (carousel && prevBtn && nextBtn) {
            nextBtn.addEventListener('click', () => {
                const firstCard = carousel.querySelector('.product-card');
                if (firstCard) {
                    const scrollAmount = firstCard.offsetWidth + 24; // Card width + gap
                    carousel.scrollLeft += scrollAmount;
                }
            });

            prevBtn.addEventListener('click', () => {
                const firstCard = carousel.querySelector('.product-card');
                if (firstCard) {
                    const scrollAmount = firstCard.offsetWidth + 24; // Card width + gap
                    carousel.scrollLeft -= scrollAmount;
                }
            });
        }
    });

    // --- Global Wishlist Toggle Logic ---
    document.body.addEventListener('click', function(event) {
        const wishlistBtn = event.target.closest('.wishlist-toggle-btn');
        if (wishlistBtn) {
            const productId = wishlistBtn.dataset.productId;
            const icon = wishlistBtn.querySelector('i');

            fetch('/account/wishlist/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId: productId })
            })
            .then(response => {
                if (!response.ok) {
                    if (response.status === 401 || response.redirected) {
                        window.location.href = '/users/login';
                        return;
                    }
                    throw new Error('Network response was not ok');
                }
                return response.json();
            })
            .then(data => {
                if (data && data.success) {
                    if (data.newStatus === 'added') {
                        icon.classList.remove('bi-heart');
                        icon.classList.add('bi-heart-fill');
                    } else {
                        icon.classList.remove('bi-heart-fill');
                        icon.classList.add('bi-heart');
                    }
                }
            })
            .catch(error => {
                console.error('Wishlist toggle error:', error);
            });
        }
    });


    // --- Admin Product Page Logic ---
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
                    if (event.target.tagName !== 'INPUT') {
                        checkbox.checked = !checkbox.checked;
                    }
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

        // --- Inventory Tab Logic (Simplified) ---
        const inventoryTable = document.getElementById('inventory-table');
        if (inventoryTable) {
            const selectAllCheckbox = document.getElementById('select-all-inventory');
            const tableBody = inventoryTable.querySelector('tbody');
            const deleteActionBar = document.getElementById('delete-action-bar');
            const selectedDeleteCountSpan = document.getElementById('selected-delete-count');
            
            const updateDeleteSelectionState = () => {
                const checkedCount = tableBody.querySelectorAll('.inventory-checkbox:checked').length;
                selectedDeleteCountSpan.textContent = checkedCount;
                deleteActionBar.classList.toggle('is-active', checkedCount > 0);
                const allCheckboxes = tableBody.querySelectorAll('.inventory-checkbox');
                if (selectAllCheckbox) {
                    selectAllCheckbox.checked = allCheckboxes.length > 0 && checkedCount === allCheckboxes.length;
                }
            };

            if (selectAllCheckbox) {
                selectAllCheckbox.addEventListener('change', () => {
                    tableBody.querySelectorAll('.inventory-checkbox').forEach(checkbox => {
                        checkbox.checked = selectAllCheckbox.checked;
                    });
                    updateDeleteSelectionState();
                });
            }

            tableBody.addEventListener('change', (e) => {
                if (e.target.classList.contains('inventory-checkbox')) {
                    updateDeleteSelectionState();
                }
            });
            
            updateDeleteSelectionState();
        }
    }

    // --- ADDED: Mobile Cart Checkout Button Logic ---
    const mobileCheckoutBtn = document.getElementById('mobile-checkout-btn');
    const checkoutOptions = document.getElementById('checkout-options');

    if (mobileCheckoutBtn && checkoutOptions) {
        mobileCheckoutBtn.addEventListener('click', function() {
            this.style.display = 'none'; // Hide the main button
            checkoutOptions.classList.add('is-active');
        });

        // Close the options if the user clicks outside of them
        document.addEventListener('click', function(event) {
            if (!mobileCheckoutBtn.contains(event.target) && !checkoutOptions.contains(event.target)) {
                mobileCheckoutBtn.style.display = 'block'; // Show the main button again
                checkoutOptions.classList.remove('is-active');
            }
        });
    }
});